const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),threshold=document.getElementById("threshold"),thresholdValue=document.getElementById("thresholdValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let sourceCanvas=null,sourceCtx=null,currentFile=null,mode="image",frames=[],frameDelays=[],processing=false,animationTimer=null;

dropZone.addEventListener("click",()=>fileInput.click());
fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
threshold.addEventListener("input",()=>{thresholdValue.textContent=threshold.value+"%";if(mode==="image")applyImage();else if(frames.length)renderFrame(0)});

function resetState(){if(animationTimer)clearTimeout(animationTimer);animationTimer=null;sourceCanvas=null;sourceCtx=null;frames=[];frameDelays=[];currentFile=null;mode="image";processing=false;canvas.hidden=true;placeholder.hidden=false;download.disabled=true;reset.disabled=true;fileName.textContent="Ningún archivo seleccionado · Las imágenes salen en PNG, los GIF en GIF y los vídeos en WebM."}

function loadFile(file){
 if(!file)return;
 const type=file.type||"";
 if(type==="image/gif"||file.name.toLowerCase().endsWith(".gif"))loadGif(file);
 else if(type.startsWith("video/")||/\.mp4$/i.test(file.name))loadVideo(file);
 else if(type.startsWith("image/"))loadImage(file);
 else alert("Formato no compatible. Usa una imagen, GIF o MP4.");
}

function prepareCanvas(w,h){const max=2200,scale=Math.min(1,max/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));sourceCanvas=document.createElement("canvas");sourceCanvas.width=canvas.width;sourceCanvas.height=canvas.height;sourceCtx=sourceCanvas.getContext("2d");canvas.hidden=false;placeholder.hidden=true;download.disabled=false;reset.disabled=false}

function applyPixels(c){
 const cctx=c.getContext("2d"),data=cctx.getImageData(0,0,c.width,c.height),limit=Number(threshold.value)*2.55;
 for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2],brightness=.299*r+.587*g+.114*b;if(brightness<=limit)data.data[i+3]=0}
 cctx.putImageData(data,0,0)
}

function loadImage(file){
 resetState();currentFile=file;mode="image";const img=new Image(),url=URL.createObjectURL(file);
 img.onload=()=>{prepareCanvas(img.naturalWidth,img.naturalHeight);sourceCtx.drawImage(img,0,0,canvas.width,canvas.height);applyImage();fileName.textContent=file.name+" · "+canvas.width+"×"+canvas.height;URL.revokeObjectURL(url)};
 img.onerror=()=>{URL.revokeObjectURL(url);alert("No se pudo abrir la imagen.")};img.src=url
}
function applyImage(){if(!sourceCanvas)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(sourceCanvas,0,0);applyPixels(canvas);thresholdValue.textContent=threshold.value+"%"}
async function loadGif(file){
 resetState();currentFile=file;mode="gif";fileName.textContent=file.name+" · procesando GIF…";
 try{
  const buf=await file.arrayBuffer(),gif=parseGIF(buf),raw=decompressFrames(gif,true);if(!raw.length)throw new Error("Sin frames");
  const max=900,scale=Math.min(1,max/Math.max(raw[0].dims.width,raw[0].dims.height)),w=Math.max(1,Math.round(raw[0].dims.width*scale)),h=Math.max(1,Math.round(raw[0].dims.height*scale));
  prepareCanvas(w,h);frames=[];frameDelays=[];
  for(const f of raw){const fc=document.createElement("canvas");fc.width=w;fc.height=h;const fctx=fc.getContext("2d"),tmp=f.patch;const pc=document.createElement("canvas");pc.width=f.dims.width;pc.height=f.dims.height;const pctx=pc.getContext("2d");pctx.putImageData(new ImageData(tmp,f.dims.width,f.dims.height),0,0);fctx.drawImage(pc,f.dims.left*scale,f.dims.top*scale,f.dims.width*scale,f.dims.height*scale);applyPixels(fc);frames.push(fc);frameDelays.push(Math.max(20,f.delay||100))}
  fileName.textContent=file.name+" · "+frames.length+" frames";renderFrame(0);download.disabled=false
 }catch(e){console.error(e);resetState();alert("No se pudo procesar el GIF.")}
}
function renderFrame(i){if(!frames.length)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(frames[i],0,0);if(animationTimer)clearTimeout(animationTimer);animationTimer=setTimeout(()=>renderFrame((i+1)%frames.length),frameDelays[i]||100)}
async function loadVideo(file){
 resetState();currentFile=file;mode="video";fileName.textContent=file.name+" · cargando vídeo…";
 const video=document.createElement("video");video.muted=true;video.playsInline=true;video.preload="auto";const url=URL.createObjectURL(file);video.src=url;
 try{await new Promise((res,rej)=>{video.onloadedmetadata=res;video.onerror=rej});
  prepareCanvas(video.videoWidth,video.videoHeight);const fps=Math.min(30,Math.max(1,30));const stream=canvas.captureStream(fps),mime=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw new Error("WebM no soportado");
  const chunks=[],rec=new MediaRecorder(stream,{mimeType:mime});rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  const done=new Promise(res=>rec.onstop=()=>res(new Blob(chunks,{type:mime})));rec.start();
  video.currentTime=0;await new Promise(r=>video.onseeked=r);const duration=video.duration,start=performance.now();
  while(video.currentTime<duration-0.01){sourceCtx.clearRect(0,0,canvas.width,canvas.height);sourceCtx.drawImage(video,0,0,canvas.width,canvas.height);applyImage();await new Promise(r=>setTimeout(r,Math.max(1,1000/fps)));video.currentTime=Math.min(duration,video.currentTime+1/fps);await new Promise(r=>video.onseeked=r)}
  rec.stop();const blob=await done;window.__removeDarkVideo=blob;download.disabled=false;fileName.textContent=file.name+" · vídeo procesado · salida WebM";ctx.clearRect(0,0,canvas.width,canvas.height);sourceCtx.clearRect(0,0,canvas.width,canvas.height);URL.revokeObjectURL(url)
 }catch(e){console.error(e);URL.revokeObjectURL(url);resetState();alert("No se pudo procesar el MP4. Tu navegador puede no permitir exportación WebM con transparencia.")}
}
download.addEventListener("click",()=>{
 if(!currentFile)return;
 if(mode==="image"){const a=document.createElement("a");a.download="neotools-remove-dark.png";a.href=canvas.toDataURL("image/png");a.click()}
 else if(mode==="gif"){
  const gif=new GIF({workers:2,quality:10,width:canvas.width,height:canvas.height,transparent:"rgba(0,0,0,0)",workerScript:"https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js"});frames.forEach((f,i)=>gif.addFrame(f,{delay:frameDelays[i]||100,copy:true}));download.disabled=true;gif.on("finished",blob=>{const a=document.createElement("a");a.download="neotools-remove-dark.gif";a.href=URL.createObjectURL(blob);a.click();download.disabled=false});gif.render()
 }else if(mode==="video"&&window.__removeDarkVideo){const a=document.createElement("a");a.download="neotools-remove-dark.webm";a.href=URL.createObjectURL(window.__removeDarkVideo);a.click()}
});
reset.addEventListener("click",()=>{fileInput.value="";resetState()});
