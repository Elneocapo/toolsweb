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
    const alpha=data.data[i+3];
    const brightness=.299*data.data[i]+.587*data.data[i+1]+.114*data.data[i+2];

    if(alpha<255 || brightness<=limit){
      data.data[i]=0;
      data.data[i+1]=0;
      data.data[i+2]=0;
      data.data[i+3]=0;
    }
  }

  targetCtx.putImageData(data,0,0);
}


function cleanGreenArtifacts(target){
  const targetCtx=target.getContext("2d",{willReadFrequently:true});
  const data=targetCtx.getImageData(0,0,target.width,target.height);
  const {width,height}=target;
  const original=new Uint8ClampedArray(data.data);
  const isArtifact=(i)=>{
    const r=original[i],g=original[i+1],b=original[i+2],a=original[i+3];
    return a===255 && g>=180 && g-Math.max(r,b)>=120 && r<=40 && b<=40;
  };
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(!isArtifact(i))continue;
      let transparentNeighbors=0;
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++){
          if(dx===0&&dy===0)continue;
          const nx=x+dx,ny=y+dy;
          if(nx<0||ny<0||nx>=width||ny>=height)continue;
          const ni=(ny*width+nx)*4;
          if(original[ni+3]===0)transparentNeighbors++;
        }
      }
      if(transparentNeighbors>=4){
        data.data[i]=0;data.data[i+1]=0;data.data[i+2]=0;data.data[i+3]=0;
      }
    }
  }
  targetCtx.putImageData(data,0,0);
}


function chooseTransparentKey(source){
  const ctx=source.getContext("2d",{willReadFrequently:true});
  const data=ctx.getImageData(0,0,source.width,source.height).data;
  const used=new Set();
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===255){
      used.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);
    }
  }
  let key=1;
  while(key<=0xffffff&&used.has(key))key++;
  if(key>0xffffff)throw new Error("No hay color libre para la transparencia.");
  return [(key>>16)&255,(key>>8)&255,key&255];
}

function exportPng(){
  if(!currentFile||mode!=="image")return;

  const output=makeCanvas(canvas.width,canvas.height);
  const octx=output.getContext("2d",{willReadFrequently:true});
  octx.clearRect(0,0,output.width,output.height);
  octx.drawImage(sourceCanvas,0,0);
  applyPixels(output);
  cleanGreenArtifacts(output);

  // Final pass: transparent pixels contain no residual RGB data.
  const data=octx.getImageData(0,0,output.width,output.height);
  for(let i=0;i<data.data.length;i+=4){
    if(data.data[i+3]!==255){
      data.data[i]=0;
      data.data[i+1]=0;
      data.data[i+2]=0;
      data.data[i+3]=0;
    }
  }
  octx.putImageData(data,0,0);

  output.toBlob(blob=>{
    if(!blob)return;
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.download="neotools-remove-dark.png";
    a.href=url;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  },"image/png");
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
  cleanGreenArtifacts(canvas);
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
  if(typeof ImageDecoder!=="undefined"){
    const buffer=await file.arrayBuffer();
    const decoder=new ImageDecoder({data:buffer,type:"image/gif"});
    await decoder.tracks.ready;
    const track=decoder.tracks.selectedTrack;
    if(track&&track.frameCount){
      const first=await decoder.decode({frameIndex:0,completeFramesOnly:true});
      const image=first.image;
      const sourceW=image.displayWidth||image.codedWidth;
      const sourceH=image.displayHeight||image.codedHeight;
      const scale=Math.min(1,maxSide/Math.max(sourceW,sourceH));
      const width=Math.max(1,Math.round(sourceW*scale));
      const height=Math.max(1,Math.round(sourceH*scale));
      if(image.close)image.close();
      return {type:"decoder",decoder,count:track.frameCount,width,height};
    }
    if(decoder.close)decoder.close();
  }

  if(typeof parseGIF!=="function"||typeof decompressFrames!=="function"){
    throw new Error("No se pudo cargar el lector de GIF.");
  }

  const buffer=await file.arrayBuffer();
  const parsed=parseGIF(buffer);
  const raw=decompressFrames(parsed,true);
  if(!raw.length)throw new Error("El GIF no contiene frames.");

  const logicalW=parsed.lsd.width,logicalH=parsed.lsd.height;
  const scale=Math.min(1,maxSide/Math.max(logicalW,logicalH));
  const width=Math.max(1,Math.round(logicalW*scale));
  const height=Math.max(1,Math.round(logicalH*scale));
  const composite=makeCanvas(width,height);
  const cctx=composite.getContext("2d");
  let previousDisposal=0,previousDims=null,restoreCanvas=null;
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
      cctx.clearRect(0,0,width,height);
      cctx.drawImage(restoreCanvas,0,0);
    }

    let currentRestore=null;
    if(frame.disposalType===3){
      currentRestore=makeCanvas(width,height);
      currentRestore.getContext("2d").drawImage(composite,0,0);
    }

    const patch=makeCanvas(frame.dims.width,frame.dims.height);
    patch.getContext("2d").putImageData(
      new ImageData(frame.patch,frame.dims.width,frame.dims.height),0,0
    );

    cctx.drawImage(
      patch,
      Math.round(frame.dims.left*scale),
      Math.round(frame.dims.top*scale),
      Math.max(1,Math.round(frame.dims.width*scale)),
      Math.max(1,Math.round(frame.dims.height*scale))
    );

    const snapshot=makeCanvas(width,height);
    snapshot.getContext("2d").drawImage(composite,0,0);
    decoded.push({
      canvas:snapshot,
      delay:Math.max(20,Number(frame.delay)||100)
    });

    previousDisposal=frame.disposalType||0;
    previousDims=frame.dims;
    restoreCanvas=currentRestore;
  }

  return {type:"frames",frames:decoded,width,height};
}

async function getDecoderFrame(index){
  const result=await gifImage.decode({frameIndex:index,completeFramesOnly:true});
  const image=result.image;
  const out=makeCanvas(canvas.width,canvas.height);
  out.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
  const delay=Number.isFinite(image.duration)?Math.max(20,Math.round(image.duration/1000)):100;
  if(image.close)image.close();
  return {canvas:out,delay};
}
function previewGifFrame(index){
  if(mode!=="gif"||!frames.length)return;
  const frame=frames[index%frames.length];
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(frame,0,0);
  applyPixels(canvas);
  cleanGreenArtifacts(canvas);
  const delay=Math.max(20,frameDelays[index%frameDelays.length]||100);
  gifPreviewTimer=setTimeout(()=>previewGifFrame((index+1)%frames.length),delay);
}

async function previewDecoderFrame(index){
  if(mode!=="gif"||!gifImage)return;
  try{
    const count=gifImage.tracks.selectedTrack.frameCount;
    const frame=await getDecoderFrame(index%count);
    if(mode!=="gif"||!gifImage)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(frame.canvas,0,0);
    applyPixels(canvas);
    cleanGreenArtifacts(canvas);
    gifPreviewTimer=setTimeout(()=>previewDecoderFrame((index+1)%count),frame.delay);
  }catch(error){
    console.error("REMOVE DARK GIF preview:",error);
    fileName.textContent=currentFile.name+" · preview no disponible";
  }
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

    if(decoded.type==="decoder"){
      gifImage=decoded.decoder;
      frames=[];
      frameDelays=[];
      canvas.width=decoded.width;
      canvas.height=decoded.height;
      canvas.hidden=false;
      placeholder.hidden=true;
      download.disabled=false;
      fileName.textContent=file.name+" · GIF animado";
      previewDecoderFrame(0);
      return;
    }

    gifImage=null;
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
async function exportGif(){
  if(!currentFile)return;

  download.disabled=true;
  fileName.textContent=currentFile.name+" · generando GIF…";

  try{
    let exportFrames=[];
    let exportDelays=[];

    if(gifImage){
      const count=gifImage.tracks.selectedTrack.frameCount;
      const scale=Math.min(1,360/Math.max(canvas.width,canvas.height));
      const w=Math.max(1,Math.round(canvas.width*scale));
      const h=Math.max(1,Math.round(canvas.height*scale));

      for(let i=0;i<count;i++){
        const result=await gifImage.decode({frameIndex:i,completeFramesOnly:true});
        const image=result.image;
        const out=makeCanvas(w,h);
        out.getContext("2d").drawImage(image,0,0,w,h);
        applyPixels(out);
        exportFrames.push(out);
        exportDelays.push(Number.isFinite(image.duration)?Math.max(20,Math.round(image.duration/1000)):100);
        if(image.close)image.close();
      }
    }else{
      exportFrames=[];
      exportDelays=frameDelays.slice();
      for(const frame of frames){
        const processed=makeCanvas(frame.width,frame.height);
        const pctx=processed.getContext("2d",{willReadFrequently:true});
        pctx.drawImage(frame,0,0);
        applyPixels(processed);
        cleanGreenArtifacts(processed);
        exportFrames.push(processed);
      }
    }

    if(!exportFrames.length)throw new Error("No hay frames para exportar.");

    const transparentKey=chooseTransparentKey(exportFrames[0]);
    const transparentColor=(transparentKey[0]<<16)|(transparentKey[1]<<8)|transparentKey[2];

    const gif=new GIF({
      workers:1,
      quality:20,
      width:exportFrames[0].width,
      height:exportFrames[0].height,
      repeat:0,
      workerScript:"gif.worker.js?v=3",
      dither:false,
      transparent:transparentColor
    });

    exportFrames.forEach((frame,i)=>{
      const out=makeCanvas(frame.width,frame.height);
      const octx=out.getContext("2d");
      octx.fillStyle=`rgb(${transparentKey[0]},${transparentKey[1]},${transparentKey[2]})`;
      octx.fillRect(0,0,out.width,out.height);
      octx.drawImage(frame,0,0);
      const data=octx.getImageData(0,0,out.width,out.height);

      for(let p=0;p<data.data.length;p+=4){
        if(data.data[p+3]<128){
          data.data[p]=transparentKey[0];
          data.data[p+1]=transparentKey[1];
          data.data[p+2]=transparentKey[2];
        }
        data.data[p+3]=255;
      }

      octx.putImageData(data,0,0);
      gif.addFrame(out,{delay:exportDelays[i]||100,copy:true});
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
    exportPng();
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
