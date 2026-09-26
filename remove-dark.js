const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),threshold=document.getElementById("threshold"),thresholdValue=document.getElementById("thresholdValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let sourceCanvas=null,currentFile=null;

function updateThresholdLabel(){thresholdValue.textContent=threshold.value+"%";}

function resetState(){
  sourceCanvas=null;
  currentFile=null;
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  threshold.value=20;
  updateThresholdLabel();
  fileName.textContent="Ningún archivo seleccionado · Las imágenes salen en PNG y los GIF en GIF.";
}

function loadFile(file){
  if(!file||!file.type.startsWith("image/")||file.type==="image/gif"||/\.gif$/i.test(file.name||""))return;
  const img=new Image();
  const url=URL.createObjectURL(file);
  img.onload=()=>{
    const max=2200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.width=w;canvas.height=h;
    sourceCanvas=document.createElement("canvas");
    sourceCanvas.width=w;sourceCanvas.height=h;
    sourceCanvas.getContext("2d").drawImage(img,0,0,w,h);
    currentFile=file;
    applyImage();
    fileName.textContent=file.name+" · "+w+"×"+h;
    canvas.hidden=false;placeholder.hidden=true;download.disabled=false;reset.disabled=false;
    URL.revokeObjectURL(url);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);alert("No se pudo abrir la imagen.")};
  img.src=url;
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

function applyImage(){
  if(!sourceCanvas)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(sourceCanvas,0,0);
  applyPixels(canvas);
  updateThresholdLabel();
}

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
dropZone.addEventListener("click",e=>{if(e.target!==fileInput)fileInput.click()});
["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
threshold.addEventListener("input",applyImage);
download.addEventListener("click",()=>{
  if(!currentFile)return;
  const a=document.createElement("a");
  a.download="neotools-remove-dark.png";
  a.href=canvas.toDataURL("image/png");
  a.click();
});
reset.addEventListener("click",()=>{fileInput.value="";resetState()});
updateThresholdLabel();

window.NeoGif.register({
  fileInput,dropZone,download,reset,canvas,ctx,placeholder,fileName,maxSide:1000,gifMaxSide:640,gifMaxSide:640,transparent:true,
  renderFrame(frame){
    const out=document.createElement("canvas");
    out.width=frame.width;out.height=frame.height;
    out.getContext("2d").drawImage(frame,0,0);
    applyPixels(out);
    return out;
  }
});
