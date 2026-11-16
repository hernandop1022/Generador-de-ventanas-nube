(function(){
 'use strict';
 const SCOPE='https://www.googleapis.com/auth/drive.file';
 let accessToken='',expires=0,account=null,store=null,connecting=false,booted=false,hooks=null,draft=null;
 let readyResolve;const connected=new Promise(resolve=>readyResolve=resolve);
 let ui={};
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 function status(message,error=false){if(ui.status){ui.status.textContent=message;ui.status.style.color=error?'#a32121':'#315f49';}}
 function token(){if(Date.now()>expires)return '';return accessToken;}
 function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 let draftDB;
 function database(){return draftDB||=new Promise((resolve,reject)=>{const r=indexedDB.open('generador-nube-rescate',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('No se pudo abrir el respaldo de cambios pendientes.'));});}
 async function draftAction(method,value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',method==='get'?'readonly':'readwrite');const os=tx.objectStore('drafts');const r=method==='put'?os.put(value,account.permissionId):os[method](account.permissionId);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(Error('No se pudo conservar el borrador en este dispositivo.'));});}
 async function saveDraft(data){draft=JSON.parse(JSON.stringify(data));await draftAction('put',draft);ui.recover.hidden=false;}
 async function offerRecovery(){
  if(!draft)return;
  await new Promise(resolve=>{
   const d=make('dialog');d.className='project-dialog';d.append(make('h2','Hay cambios pendientes de una sesión anterior'),make('p','Descarga el borrador antes de continuar. Puedes importarlo como una copia desde Copias de seguridad. Los proyectos de Drive se cargarán por separado.'));
   const get=make('button','Descargar borrador y continuar');get.className='home-btn primary';get.onclick=()=>{download(draft,'borrador-recuperado.json');d.close();d.remove();resolve();};
   const skip=make('button','Continuar sin recuperar');skip.className='home-btn';skip.onclick=()=>{if(confirm('Los próximos cambios pueden reemplazar este borrador local. ¿Continuar sin descargarlo?')){d.close();d.remove();resolve();}};
   d.append(get,skip);d.addEventListener('cancel',e=>e.preventDefault());document.body.append(d);d.showModal();
  });
 }
 async function conflict(versions){
  return new Promise(resolve=>{
   const d=make('dialog');d.className='project-dialog';d.style.cssText='width:min(680px,94vw);max-width:680px;max-height:90vh;overflow:auto';
   d.append(make('h2','Hay versiones de dos dispositivos'),make('p','Ambas están conservadas en Drive. Descarga las copias para compararlas y elige cuál continuar. La siguiente edición creará una nueva versión sin borrar las anteriores.'));
   for(const v of versions){const box=make('section');box.style.cssText='padding:16px 0;border-bottom:1px solid #ddd';box.append(make('h3',v.data.proyectos[0].nombre),make('p',new Date(v.file.createdTime).toLocaleString()+' · '+v.data.disenos.length+' referencias'));
    const copy=make('button','Descargar esta versión');copy.className='home-btn';copy.onclick=()=>download(v.data,'version-'+v.file.id+'.json');
    const use=make('button','Continuar con esta versión');use.className='home-btn primary';use.onclick=()=>{d.close();d.remove();resolve(v.file.id);};box.append(copy,use);d.append(box);
   }d.addEventListener('cancel',e=>e.preventDefault());document.body.append(d);d.showModal();
  });
 }
 function handle(error){if(error.code==='auth'){accessToken='';ui.connect.hidden=false;}status(error.message,true);}
 async function completeAuth(response){
  try{
   if(response.error||!response.access_token)throw Error('Google no autorizó la conexión. Puedes volver a intentarlo.');
   if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE))throw Error('Falta autorizar el acceso a los archivos creados por el generador.');
   accessToken=response.access_token;expires=Date.now()+(Number(response.expires_in||3600)-60)*1000;
   const probe=new WindowDrive.DriveStore({token,namespace:CLOUD_CONFIG.namespace});
   const about=await probe.json('about?fields=user(permissionId,emailAddress)');
   if(!about.user?.permissionId)throw Error('No se pudo identificar la cuenta conectada.');
   if(account&&account.permissionId!==about.user.permissionId){accessToken='';throw Error('Conectaste otra cuenta. Vuelve a conectar la cuenta anterior para guardar estos cambios.');}
   account=about.user;ui.account.textContent=account.emailAddress||'Cuenta Google conectada';
   if(!store){store=new WindowDrive.DriveStore({token,namespace:CLOUD_CONFIG.namespace,onConflict:conflict,onPending:saveDraft});draft=await draftAction('get');ui.recover.hidden=!draft;await offerRecovery();}
   status('Google Drive conectado.');ui.connect.textContent='Renovar conexión';
   if(!booted){booted=true;readyResolve();}else if(hooks){await hooks.retry();}
  }catch(error){handle(error);}finally{connecting=false;ui.connect.disabled=false;}
 }
 function connect(){
  if(connecting)return;
  try{
   if(!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(CLOUD_CONFIG.clientId))throw Error('Falta configurar la conexión de Google. Consulta «Configurar conexión».');
   if(!window.google?.accounts?.oauth2)throw Error('No se cargó la conexión de Google. Comprueba Internet y recarga la página.');
   connecting=true;ui.connect.disabled=true;status('Esperando autorización de Google…');
   // Debe ejecutarse directamente desde el clic: compatible con el bloqueo de popups de Safari.
   google.accounts.oauth2.initTokenClient({client_id:CLOUD_CONFIG.clientId,scope:SCOPE,include_granted_scopes:false,callback:completeAuth,error_callback:()=>{connecting=false;ui.connect.disabled=false;status('La ventana de Google se cerró o fue bloqueada. Vuelve a conectar.',true);}}).requestAccessToken({prompt:'select_account'});
  }catch(error){connecting=false;ui.connect.disabled=false;handle(error);}
 }
 window.cloudStore={
  attach(value){hooks=value;},
  async request(method,db){
   try{
    await connected;
    if(method==='GET'){status('Cargando proyectos de Drive…');const data=await store.load();status('Proyectos cargados de Google Drive.');return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','ETag':'cloud'}});}
    status('Guardando en Google Drive…');await store.save(db);await draftAction('delete');draft=null;ui.recover.hidden=true;
    status('Guardado en Google Drive · '+new Date().toLocaleTimeString());return new Response('{"ok":true}',{headers:{'ETag':'cloud'}});
   }catch(error){handle(error);throw error;}
  },
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const style=make('style');style.textContent='#cloudBar{grid-column:1/-1;background:#fff;border-bottom:1px solid #d6d0c8;padding:12px 22px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}#cloudBar button,#cloudBar a{font:13px Arial,sans-serif;padding:9px;border:1px solid #cbd2d7;border-radius:6px;background:white;color:#234e73;cursor:pointer}#cloudStatus{width:100%;font-size:13px}#cloudAccount{font-size:12px;color:#555}body:not(.project-home){grid-template-rows:auto auto auto auto 1fr!important}';document.head.append(style);
  const bar=make('section');bar.id='cloudBar';bar.setAttribute('aria-label','Conexión con Google Drive');
  bar.append(make('strong','Versión nube · Prueba'));
  ui.connect=make('button','Conectar con Google Drive');ui.connect.onclick=connect;
  ui.account=make('span');ui.account.id='cloudAccount';
  ui.refresh=make('button','Actualizar desde Drive');ui.refresh.onclick=async()=>{if(!hooks||!booted)return status('Conecta con Google Drive primero.',true);if(hooks.dirty()&&!confirm('Hay cambios pendientes. Descárgalos antes de actualizar. ¿Descartar los cambios en pantalla y cargar Drive?'))return;try{await hooks.reload();}catch(e){handle(e);}};
  ui.retry=make('button','Reintentar guardado');ui.retry.onclick=async()=>{if(!hooks||!booted)return status('Conecta con Google Drive primero.',true);try{await hooks.retry();}catch(e){handle(e);}};
  ui.rescue=make('button','Descargar cambios pendientes');ui.rescue.onclick=()=>{try{if(!hooks?.snapshot)throw Error('Todavía no hay proyectos cargados.');download(hooks.snapshot(),'rescate-proyectos.json');}catch(e){handle(e);}};
  ui.recover=make('button','Recuperar borrador de este dispositivo');ui.recover.hidden=true;ui.recover.onclick=()=>{if(draft)download(draft,'borrador-recuperado.json');};
  const help=make('a','Configurar conexión');help.href='configuracion.html';help.target='_blank';help.rel='noopener';
  ui.status=make('p');ui.status.id='cloudStatus';ui.status.setAttribute('role','status');
  bar.append(ui.connect,ui.account,ui.refresh,ui.retry,ui.rescue,ui.recover,help,ui.status);document.querySelector('header').after(bar);status('Conecta tu cuenta de Google para abrir tus proyectos.');
  addEventListener('offline',()=>status('Sin conexión. Los cambios no están confirmados en Drive; mantén abierta la página o descarga una copia.',true));
  addEventListener('online',()=>status('Volvió Internet. Pulsa Reintentar guardado para confirmar tus cambios.'));
 });
})();
