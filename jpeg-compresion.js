const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const compression=document.getElementById("compression");
const compressionValue=document.getElementById("compressionValue");
const blockSize=document.getElementById("blockSize");
const blockSizeValue=document.getElementById("blockSizeValue");
const acGain=document.getElementById("acGain");
const acGainValue=document.getElementById("acGainValue");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

const MAX_SIDE=800;
let image=null;
let url=null;
let sourceCanvas=null;
let sourceCtx=null;
let sourceData=null;
let worker=null;
let renderToken=0;
let renderTimer=0;
let workerBusy=false;
let pendingRender=false;
let latestBlob=null;

function setLabels(){
  compressionValue.textContent=Number(compression.value)+"%";
  blockSizeValue.textContent=Number(blockSize.value)+"px";
  acGainValue.textContent=Number(acGain.value)+"%";
}

function makeWorker(){
  try{
    const w=new Worker("jpeg-compresion-worker.js?v=1");

    w.onmessage=event=>{
      const data=event.data;

      if(data.type==="ready"){
        workerBusy=false;
        requestRender();
        return;
      }

      if(data.type==="result"){
        workerBusy=false;

        if(data.token!==renderToken){
          pendingRender=true;
          requestRender();
          return;
        }

        const result=new Uint8ClampedArray(data.buffer);
        ctx.putImageData(new ImageData(result,canvas.width,canvas.height),0,0);
        canvas.hidden=false;
        placeholder.hidden=true;
        download.disabled=false;
        reset.disabled=false;

        canvas.toBlob(blob=>{
          if(data.token===renderToken)latestBlob=blob;
        },"image/jpeg",0.98);

        if(pendingRender){
          pendingRender=false;
          requestRender();
        }
        return;
      }

      if(data.type==="error"){
        console.error("JPEG worker:",data.message);
        workerBusy=false;
        pendingRender=false;
      }
    };

    w.onerror=error=>{
      console.error("JPEG worker error:",error);
      workerBusy=false;
      pendingRender=false;
      if(worker===w){
        worker.terminate();
        worker=null;
      }
    };

    return w;
  }catch(error){
    console.error("No se pudo crear el JPEG worker:",error);
    return null;
  }
}

function requestRender(){
  if(!image)return;

  const value=Number(compression.value);
  const size=Number(blockSize.value);
  const gain=Number(acGain.value);
  const token=renderToken;

  if(value===0 && gain===100){
    pendingRender=false;
    if(sourceData){
      const copy=new Uint8ClampedArray(sourceData);
      ctx.putImageData(new ImageData(copy,canvas.width,canvas.height),0,0);
      canvas.hidden=false;
      placeholder.hidden=true;
      download.disabled=false;
      reset.disabled=false;

      canvas.toBlob(blob=>{
        if(token===renderToken)latestBlob=blob;
      },"image/jpeg",0.98);
    }
    return;
  }

  if(!worker){
    worker=makeWorker();
  }

  if(worker){
    if(workerBusy){
      pendingRender=true;
      return;
    }

    workerBusy=true;
    pendingRender=false;

    worker.postMessage({
      type:"render",
      token,
      compression:value,
      blockSize:size,
      acGain:gain
    });
  }
}

function scheduleRender(){
  setLabels();
  renderToken++;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    renderTimer=0;
    requestRender();
  },35);
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;

  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(file);

  const img=new Image();

  img.onload=()=>{
    image=img;

    const scale=Math.min(
      1,
      MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight)
    );

    const w=Math.max(1,Math.round(img.naturalWidth*scale));
    const h=Math.max(1,Math.round(img.naturalHeight*scale));

    canvas.width=w;
    canvas.height=h;

    sourceCanvas=document.createElement("canvas");
    sourceCanvas.width=w;
    sourceCanvas.height=h;

    sourceCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});
    sourceCtx.drawImage(img,0,0,w,h);
    sourceData=sourceCtx.getImageData(0,0,w,h).data;

    latestBlob=null;
    renderToken++;
    pendingRender=false;
    workerBusy=false;

    compression.value=0;
    blockSize.value=8;
    acGain.value=100;
    setLabels();

    fileName.textContent=file.name+" · JPEG procesado en tu navegador.";

    if(worker){
      worker.terminate();
      worker=null;
    }

    worker=makeWorker();

    if(worker){
      const initData=new Uint8ClampedArray(sourceData);

      worker.postMessage({
        type:"init",
        width:w,
        height:h,
        buffer:initData.buffer,
        blockSize:8
      },[initData.buffer]);
    }
  };

  img.src=url;
}

fileInput.onchange=()=>{
  const file=fileInput.files&&fileInput.files[0];
  if(file)load(file);
};

compression.oninput=scheduleRender;
blockSize.oninput=scheduleRender;
acGain.oninput=scheduleRender;

["dragenter","dragover"].forEach(name=>{
  dropZone.addEventListener(name,event=>{
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave","drop"].forEach(name=>{
  dropZone.addEventListener(name,event=>{
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.onclick=event=>{
  if(event.target!==fileInput)fileInput.click();
};

dropZone.ondrop=event=>{
  const file=event.dataTransfer.files&&event.dataTransfer.files[0];
  if(file)load(file);
};

download.onclick=()=>{
  if(!latestBlob)return;

  const a=document.createElement("a");
  a.download="jpeg-compresion.jpg";
  a.href=URL.createObjectURL(latestBlob);
  a.click();

  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

reset.onclick=()=>{
  image=null;
  latestBlob=null;
  renderToken++;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=0;

  if(worker){
    worker.terminate();
    worker=null;
  }

  if(url){
    URL.revokeObjectURL(url);
    url=null;
  }

  sourceCanvas=null;
  sourceCtx=null;
  sourceData=null;
  workerBusy=false;
  pendingRender=false;

  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;

  compression.value=0;
  blockSize.value=8;
  acGain.value=100;
  setLabels();

  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};

setLabels();

async function renderNeoGifJpegFrame(frame){
  const w=frame.width,h=frame.height;
  const data=new Uint8ClampedArray(frame.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data);
  const frameWorker=new Worker("jpeg-compresion-worker.js?v=2");
  return new Promise((resolve,reject)=>{
    let finished=false;
    const fail=error=>{
      if(finished)return;
      finished=true;
      frameWorker.terminate();
      reject(error instanceof Error?error:new Error("No se pudo procesar el frame."));
    };
    frameWorker.onmessage=event=>{
      const message=event.data;
      if(message.type==="ready"){
        frameWorker.postMessage({
          type:"render",token:1,
          compression:Number(compression.value),
          blockSize:Number(blockSize.value),
          acGain:Number(acGain.value)
        });
      }else if(message.type==="result"){
        if(finished)return;
        finished=true;
        const out=new Uint8ClampedArray(message.buffer);
        frameWorker.terminate();
        const result=document.createElement("canvas");
        result.width=w;result.height=h;
        result.getContext("2d").putImageData(new ImageData(out,w,h),0,0);
        resolve(result);
      }else if(message.type==="error"){
        fail(new Error(message.message||"No se pudo procesar el frame."));
      }
    };
    frameWorker.onerror=fail;
    frameWorker.postMessage({
      type:"init",width:w,height:h,blockSize:Number(blockSize.value)||8,
      buffer:data.buffer
    },[data.buffer]);
  });
}

const neoGifJpegConfig={fileInput,dropZone,download,reset,canvas,ctx,placeholder,fileName,blockSize,compression,acGain};
window.NeoGif.register({
  fileInput,dropZone,download,reset,canvas,ctx,placeholder,fileName,maxSide:MAX_SIDE,gifMaxSide:640,
  async renderFrame(frame){
    return window.NeoGif.processJpegFrame(neoGifJpegConfig,frame);
  }
});
