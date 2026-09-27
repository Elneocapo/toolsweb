const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const threshold=document.getElementById("threshold");
const thresholdValue=document.getElementById("thresholdValue");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

const MAX_SIDE=2200;
const GIF_PREVIEW_SIDE=700;

let sourceCanvas=null;
let currentFile=null;
let mode="image";
let gifImage=null;
let gifObjectUrl=null;
let gifPreviewTimer=0;
let frames=[];
let frameDelays=[];

function updateThresholdLabel(){
  thresholdValue.textContent=threshold.value+"%";
}

function stopGifPreview(){
  if(gifPreviewTimer)clearTimeout(gifPreviewTimer);
  gifPreviewTimer=0;
}

function resetState(){
  stopGifPreview();
  if(gifObjectUrl){
    URL.revokeObjectURL(gifObjectUrl);
    gifObjectUrl=null;
  }
  sourceCanvas=null;
  currentFile=null;
  mode="image";
  gifImage=null;
  frames=[];
  frameDelays=[];
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  threshold.value=20;
  updateThresholdLabel();
  fileName.textContent="Ningún archivo seleccionado · Las imágenes salen en PNG y los GIF en GIF.";
}

function applyPixels(target){
  const targetCtx=target.getContext("2d",{willReadFrequently:true});
  const data=targetCtx.getImageData(0,0,target.width,target.height);
  const limit=Number(threshold.value)*2.55;

  for(let i=0;i<data.data.length;i+=4){
    const brightness=.299*data.data[i]+.587*data.data[i+1]+.114*data.data[i+2];
    if(brightness<=limit)data.data[i+3]=0;
  }

  targetCtx.putImageData(data,0,0);
}

function prepareCanvas(w,h){
  canvas.width=w;
  canvas.height=h;
  canvas.hidden=false;
  placeholder.hidden=true;
  download.disabled=false;
  reset.disabled=false;
}

function drawSourceImage(){
  if(!sourceCanvas)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(sourceCanvas,0,0);
  applyPixels(canvas);
  updateThresholdLabel();
}

function loadImage(file){
  resetState();
  currentFile=file;
  mode="image";

  const img=new Image();
  const url=URL.createObjectURL(file);

  img.onload=()=>{
    try{
      const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
      const w=Math.max(1,Math.round(img.naturalWidth*scale));
      const h=Math.max(1,Math.round(img.naturalHeight*scale));

      prepareCanvas(w,h);
      sourceCanvas=document.createElement("canvas");
      sourceCanvas.width=w;
      sourceCanvas.height=h;
      sourceCanvas.getContext("2d").drawImage(img,0,0,w,h);

      drawSourceImage();
      fileName.textContent=file.name+" · "+w+"×"+h;
    }catch(error){
      console.error("REMOVE DARK image:",error);
      fileName.textContent="No se pudo abrir la imagen.";
    }finally{
      URL.revokeObjectURL(url);
    }
  };

  img.onerror=()=>{
    URL.revokeObjectURL(url);
    fileName.textContent="No se pudo abrir la imagen.";
  };

  img.src=url;
}

function makeCanvas(w,h){
  const c=document.createElement("canvas");
  c.width=w;
  c.height=h;
  return c;
}

async function decodeGifFrames(file,maxSide){
  if(typeof parseGIF!=="function"||typeof decompressFrames!=="function"){
    throw new Error("No se pudo cargar el lector de GIF.");
  }

  const buffer=await file.arrayBuffer();
  const parsed=parseGIF(buffer);
  const raw=decompressFrames(parsed,true);

  if(!raw.length)throw new Error("El GIF no contiene frames.");

  const logicalW=parsed.lsd.width;
  const logicalH=parsed.lsd.height;
  const scale=Math.min(1,maxSide/Math.max(logicalW,logicalH));
  const w=Math.max(1,Math.round(logicalW*scale));
  const h=Math.max(1,Math.round(logicalH*scale));

  const composite=makeCanvas(w,h);
  const cctx=composite.getContext("2d");
  let previousDisposal=0;
  let previousDims=null;
  let restoreCanvas=null;
  const decoded=[];

  for(const frame of raw){
    if(previousDisposal===2&&previousDims){
      cctx.clearRect(
        Math.round(previousDims.left*scale),
        Math.round(previousDims.top*scale),
        Math.round(previousDims.width*scale),
        Math.round(previousDims.height*scale)
      );
    }else if(previousDisposal===3&&restoreCanvas){
      cctx.clearRect(0,0,w,h);
      cctx.drawImage(restoreCanvas,0,0);
    }

    let currentRestore=null;
    if(frame.disposalType===3){
      currentRestore=makeCanvas(w,h);
      currentRestore.getContext("2d").drawImage(composite,0,0);
    }

    const patch=makeCanvas(frame.dims.width,frame.dims.height);
    const pctx=patch.getContext("2d");
    pctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height
      ),
      0,0
    );

    cctx.drawImage(
      patch,
      Math.round(frame.dims.left*scale),
      Math.round(frame.dims.top*scale),
      Math.max(1,Math.round(frame.dims.width*scale)),
      Math.max(1,Math.round(frame.dims.height*scale))
    );

    const snapshot=makeCanvas(w,h);
    snapshot.getContext("2d").drawImage(composite,0,0);

    decoded.push({
      canvas:snapshot,
      delay:Math.max(20,Number(frame.delay)||100)
    });

    previousDisposal=frame.disposalType||0;
    previousDims=frame.dims;
    restoreCanvas=currentRestore;
  }

  return {frames:decoded,width:w,height:h};
}

function previewGifFrame(index){
  if(mode!=="gif"||!frames.length)return;

  const frame=frames[index%frames.length];
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(frame,0,0);

  const delay=Math.max(20,frameDelays[index%frameDelays.length]||100);
  gifPreviewTimer=setTimeout(
    ()=>previewGifFrame((index+1)%frames.length),
    delay
  );
}

async function loadGifPreview(file){
  resetState();
  currentFile=file;
  mode="gif";
  fileName.textContent=file.name+" · cargando GIF…";
  download.disabled=true;
  reset.disabled=false;

  try{
    const decoded=await decodeGifFrames(file,GIF_PREVIEW_SIDE);
    frames=decoded.frames;
    frameDelays=frames.map(frame=>frame.delay);

    prepareCanvas(decoded.width,decoded.height);
    fileName.textContent=file.name+" · "+frames.length+" frames";

    previewGifFrame(0);
    download.disabled=false;
  }catch(error){
    console.error("REMOVE DARK GIF:",error);
    resetState();
    fileName.textContent="No se pudo procesar el GIF.";
  }
}
function loadFile(file){
  if(!file)return;
  const type=file.type||"";
  if(type==="image/gif"||/\.gif$/i.test(file.name||"")){
    loadGifPreview(file);
  }else if(type.startsWith("image/")){
    loadImage(file);
  }
}

function exportGif(){
  if(!frames.length)return;

  download.disabled=true;
  fileName.textContent=currentFile.name+" · generando GIF…";

  try{
    const gif=new GIF({
      workers:1,
      quality:20,
      width:canvas.width,
      height:canvas.height,
      repeat:0,
      workerScript:"gif.worker.js?v=1",
      dither:false,
      transparent:0x00ff00
    });

    frames.forEach((frame)=>{
      const out=document.createElement("canvas");
      out.width=frame.width;
      out.height=frame.height;
      const octx=out.getContext("2d");
      octx.fillStyle="#00ff00";
      octx.fillRect(0,0,out.width,out.height);
      octx.drawImage(frame,0,0);

      const data=octx.getImageData(0,0,out.width,out.height);
      for(let i=0;i<data.data.length;i+=4){
        if(data.data[i+3]<128){
          data.data[i]=0;
          data.data[i+1]=255;
          data.data[i+2]=0;
        }
        data.data[i+3]=255;
      }
      octx.putImageData(data,0,0);

      gif.addFrame(out,{delay:frameDelays[gif.frames.length]||100,copy:true});
    });

    gif.on("finished",blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.download="neotools-remove-dark.gif";
      a.href=url;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      download.disabled=false;
      fileName.textContent=currentFile.name+" · GIF listo";
    });

    gif.on("abort",()=>{
      download.disabled=false;
      fileName.textContent=currentFile.name+" · exportación cancelada";
    });

    gif.render();
  }catch(error){
    console.error("REMOVE DARK GIF export:",error);
    download.disabled=false;
    fileName.textContent=currentFile.name+" · no se pudo exportar el GIF";
  }
}

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));

dropZone.addEventListener("click",e=>{
  if(e.target!==fileInput)fileInput.click();
});

["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
  dropZone.classList.add("dragging");
}));

["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
  dropZone.classList.remove("dragging");
}));

dropZone.addEventListener("drop",e=>{
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

threshold.addEventListener("input",()=>{
  updateThresholdLabel();
  if(mode==="image"){
    drawSourceImage();
  }
});

download.addEventListener("click",()=>{
  if(!currentFile)return;

  if(mode==="image"){
    const a=document.createElement("a");
    a.download="neotools-remove-dark.png";
    a.href=canvas.toDataURL("image/png");
    a.click();
    return;
  }

  if(mode==="gif"){
    exportGif();
  }
});

reset.addEventListener("click",()=>{
  fileInput.value="";
  resetState();
});

updateThresholdLabel();
