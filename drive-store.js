/* Drive v3. Cada escritura crea una versión inmutable: nunca PATCH/DELETE.
   Las ramas concurrentes se detectan por sus padres, no por la hora del equipo. */
(function(root){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const API='https://www.googleapis.com/drive/v3/';
 class CloudError extends Error { constructor(message,code='cloud'){super(message);this.code=code;} }
 function canonical(bundle){
  const b=clone(bundle);delete b.ultimoProyecto;delete b.ultimoDiseno;
  for(const p of b.proyectos){delete p.actualizado;delete p.ultimaReferencia;}
  for(const d of b.disenos)delete d.actualizado;
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  return JSON.stringify(sort(b));
 }
 function split(db){
  if(db?.formato!=='generador-ventanas'||db.version!==1||!Array.isArray(db.proyectos)||!Array.isArray(db.disenos))throw new CloudError('Datos de proyecto inválidos.');
  const seen=new Set();return db.proyectos.map(p=>{
   if(typeof p.id!=='string'||!p.id||seen.has(p.id))throw new CloudError('Identificador de proyecto inválido.');seen.add(p.id);
   return {formato:db.formato,version:1,proyectos:[clone(p)],disenos:clone(db.disenos.filter(d=>d.proyectoId===p.id)),ultimoProyecto:p.id,ultimoDiseno:p.ultimaReferencia};
  });
 }
 function heads(files){
  const parentIds=new Set(files.flatMap(f=>f.parentsOfRevision));
  const result=files.filter(f=>!parentIds.has(f.id));
  if(files.length&&!result.length)throw new CloudError('El historial del proyecto está dañado. Descarga una copia antes de continuar.');
  return result.sort((a,b)=>a.id.localeCompare(b.id));
 }
 const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 class DriveStore {
  constructor({fetch:fetcher=globalThis.fetch.bind(globalThis),token,namespace,onConflict=async()=>{throw new CloudError('Hay versiones simultáneas.','conflict');},onPending=async()=>{}}){
   this.fetch=fetcher;this.token=token;this.namespace=namespace;this.onConflict=onConflict;this.onPending=onPending;
   this.base=new Map();this.pending=new Map();this.folder=null;this.loaded=false;
  }
  async api(path,options={}){
   const token=this.token();if(!token)throw new CloudError('Conecta de nuevo con Google Drive para guardar.','auth');
   let response;try{response=await this.fetch(path.startsWith('https:')?path:API+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw new CloudError('No se pudo confirmar la conexión con Drive. Tus cambios siguen pendientes.','network');}
   if(!response.ok){
    if(response.status===401)throw new CloudError('La sesión de Google venció. Pulsa Conectar con Google Drive.','auth');
    const messages={403:'Google no permitió esta operación. Revisa el permiso de Drive y el espacio disponible.',404:'No se encuentra una versión del proyecto en Drive. No se sobrescribió nada.',429:'Drive está ocupado. Espera unos segundos y reintenta.'};
    throw new CloudError(messages[response.status]||'Drive no confirmó la operación ('+response.status+').',String(response.status));
   }return response;
  }
  async json(path,options){return (await this.api(path,options)).json();}
  async list(kind){
   const q="trashed = false and appProperties has { key='app' and value='"+this.namespace+"' } and appProperties has { key='kind' and value='"+kind+"' }";
   let pageToken='',all=[];
   do{const p=new URLSearchParams({q,pageSize:'1000',fields:'nextPageToken,incompleteSearch,files(id,name,createdTime,size,description,appProperties)',spaces:'drive'});if(pageToken)p.set('pageToken',pageToken);
    const page=await this.json('files?'+p);if(page.incompleteSearch)throw new CloudError('Drive devolvió una búsqueda incompleta; vuelve a intentar.');all.push(...(page.files||[]));pageToken=page.nextPageToken||'';
   }while(pageToken);
   return all;
  }
  async revisions(){
   const files=await this.list('revision');
   return files.map(f=>{let meta;try{meta=JSON.parse(f.description);}catch{throw new CloudError('Una versión de Drive tiene metadatos inválidos.');}
    if(meta.schema!==1||!Array.isArray(meta.parents)||meta.parents.some(p=>typeof p!=='string')||!f.appProperties?.project)throw new CloudError('Historial de Drive incompatible.');
    return {...f,project:f.appProperties.project,parentsOfRevision:meta.parents};
   });
  }
  async read(file){
   if(Number(file.size)>5*1024*1024)throw new CloudError('Esta versión supera el límite de 5 MB por proyecto.');
   const data=await this.json('files/'+encodeURIComponent(file.id)+'?alt=media');
   const parts=split(data);if(parts.length!==1||parts[0].proyectos[0].id!==file.project)throw new CloudError('La versión de Drive no corresponde al proyecto.');
   return parts[0];
  }
  async load(){
   const all=await this.revisions(),groups=new Map(),base=new Map();
   for(const file of all){if(!groups.has(file.project))groups.set(file.project,[]);groups.get(file.project).push(file);}
   const db={formato:'generador-ventanas',version:1,proyectos:[],disenos:[]};
   for(const [project,files] of groups){
    const tips=heads(files);let selected=tips[0];
    if(tips.length>1){const versions=[];for(const f of tips)versions.push({file:f,data:await this.read(f)});const id=await this.onConflict(versions);selected=tips.find(f=>f.id===id);if(!selected)throw new CloudError('Selección de versión cancelada.','conflict');}
    const data=await this.read(selected);base.set(project,{heads:tips.map(f=>f.id),canonical:canonical(data),needsMerge:tips.length>1});db.proyectos.push(...data.proyectos);db.disenos.push(...data.disenos);
   }
   this.base=base;this.pending.clear();this.loaded=true;return db;
  }
  async ensureFolder(){
   if(this.folder)return this.folder;
   const found=await this.list('folder');if(found.length){this.folder=found.sort((a,b)=>a.id.localeCompare(b.id))[0].id;return this.folder;}
   const folder=await this.json('files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Generador de ventanas - Proyectos',mimeType:'application/vnd.google-apps.folder',appProperties:{app:this.namespace,kind:'folder'}})});
   this.folder=folder.id;return this.folder;
  }
  async save(db){
   if(!this.loaded)throw new CloudError('Carga los proyectos de Drive antes de guardar.');
   const parts=split(db),changed=parts.filter(b=>{const old=this.base.get(b.proyectos[0].id);return !old||old.canonical!==canonical(b)||old.needsMerge;});
   if(!changed.length)return;
   await this.onPending(db);
   const all=await this.revisions();
   // Comprobar TODOS los proyectos modificados antes de empezar a subir.
   for(const b of changed){const id=b.proyectos[0].id,old=this.base.get(id),tips=heads(all.filter(f=>f.project===id));
    const pending=this.pending.get(id);
    if(pending&&tips.length===1&&tips[0].id===pending.id){
     const actual=await this.read(tips[0]);if(canonical(actual)!==canonical(pending.data))throw new CloudError('No se pudo verificar la versión enviada.');
     this.base.set(id,{heads:[pending.id],canonical:canonical(actual)});this.pending.delete(id);
    }else if(!same(tips.map(f=>f.id),old?.heads||[]))throw new CloudError('Este proyecto cambió en otro dispositivo. Descarga tus cambios pendientes y pulsa Actualizar desde Drive antes de continuar.','conflict');
   }
   for(const b of changed){
    const project=b.proyectos[0],old=this.base.get(project.id);
    if(old?.canonical===canonical(b)&&!old.needsMerge)continue;
    const folder=await this.ensureFolder();let tx=this.pending.get(project.id);
    if(!tx){const generated=await this.json('files/generateIds?count=1&space=drive&type=files');tx={id:generated.ids[0],data:clone(b),parents:old?.heads||[]};this.pending.set(project.id,tx);}
    const content=JSON.stringify(tx.data);if(new Blob([content]).size>5*1024*1024)throw new CloudError('El proyecto supera 5 MB. Divide el proyecto antes de subirlo.');
    const metadata={id:tx.id,name:project.nombre.slice(0,100)+' - '+new Date().toISOString().replace(/[:.]/g,'-')+'.json',mimeType:'application/json',parents:[folder],description:JSON.stringify({schema:1,parents:tx.parents}),appProperties:{app:this.namespace,kind:'revision',project:project.id}};
    const boundary='window_'+crypto.randomUUID(),body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+content+'\r\n--'+boundary+'--';
    try{await this.json('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});}
    catch(error){if(error.code!=='409')throw error;}
    // Confirmar el contenido recibido: un HTTP exitoso solo no basta.
    const verified=await this.read({id:tx.id,project:project.id});if(canonical(verified)!==canonical(tx.data))throw new CloudError('Drive devolvió un contenido diferente. Se conservó el borrador local.');
    this.base.set(project.id,{heads:[tx.id],canonical:canonical(verified)});this.pending.delete(project.id);
    const after=heads((await this.revisions()).filter(f=>f.project===project.id));
    if(!same(after.map(f=>f.id),[tx.id]))throw new CloudError('Se guardaron dos versiones simultáneas. Ambas están en Drive; actualiza y elige cuál continuar.','conflict');
   }
   if(parts.some(b=>this.base.get(b.proyectos[0].id)?.canonical!==canonical(b)))await this.save(db);
  }
 }
 root.WindowDrive={DriveStore,CloudError,canonical,heads,split};
 if(typeof module!=='undefined')module.exports=root.WindowDrive;
})(typeof window==='undefined'?globalThis:window);
