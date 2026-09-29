const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const stretchX=document.getElementById("stretchX");
const stretchY=document.getElementById("stretchY");
const xValue=document.getElementById("xValue");
const yValue=document.getElementById("yValue");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

let sourceCanvas=null;
let sourceWidth=0;
let sourceHeight=0;
let objectUrl=null;
let loadedFile=null;
const ratioButtons=[...document.querySelectorAll(".ratio-button")];

function updateLabels(){
  xValue.textContent=Number(stretchX.value)+"%";
  yValue.textContent=Number(stretchY.value)+"%";
}

function setActiveRatio(ratio){
  ratioButtons.forEach(button=>{
    button.classList.toggle(
      "active",
      ratio!==null && Number(button.dataset.ratio)===Number(ratio)
    );
  });
}

function stretchToRatio(ratio){
  if(!sourceCanvas){
    setActiveRatio(null);
    fileName.textContent="Sube una imagen primero para aplicar una proporción.";
    return;
  }

  const targetRatio=Number(ratio);
  const currentRatio=sourceWidth/sourceHeight;
  let x=100;
  let y=100;

  if(Math.abs(currentRatio-targetRatio)>0.000001){
    if(targetRatio>currentRatio){
      // Wider target: keep the full original height and stretch the width.
      x=(sourceHeight*targetRatio/sourceWidth)*100;
    }else{
      // Taller target: keep the full original width and stretch the height.
      y=(sourceWidth/targetRatio/sourceHeight)*100;
    }
  }

  // This tool only stretches; it never shrinks an axis below 100%.
  x=Math.max(100,Math.round(x*100)/100);
  y=Math.max(100,Math.round(y*100)/100);

  const maxX=Number(stretchX.max);
  const maxY=Number(stretchY.max);
  if(x>maxX||y>maxY){
    fileName.textContent="Esta proporción necesita más de "+maxX+"% de estiramiento en un eje.";
    return;
  }

  stretchX.value=String(x);
  stretchY.value=String(y);
  setActiveRatio(targetRatio);
  render();
}
function render(){
  if(!sourceCanvas)return;

  const x=Number(stretchX.value)/100;
  const y=Number(stretchY.value)/100;
  const width=Math.max(1,Math.round(sourceWidth*x));
  const height=Math.max(1,Math.round(sourceHeight*y));

  canvas.width=width;
  canvas.height=height;
  ctx.clearRect(0,0,width,height);
  ctx.imageSmoothingEnabled=true;

  // IMPORTANT: draw the entire source image into the new dimensions.
  // Nothing is cropped; X and Y are stretched independently.
  ctx.drawImage(sourceCanvas,0,0,sourceWidth,sourceHeight,0,0,width,height);

  canvas.hidden=false;
  placeholder.hidden=true;
  download.disabled=false;
  reset.disabled=false;

  updateLabels();
  fileName.textContent=(loadedFile?.name||"imagen")+" · "+width+"×"+height+" · imagen completa estirada";
}

function loadFile(file){
  if(!file||!file.type.startsWith("image/")){
    fileName.textContent="Selecciona una imagen válida.";
    return;
  }

  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file);
  loadedFile=file;

  const img=new Image();

  img.onload=()=>{
    const maxSide=2200;
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    sourceWidth=Math.max(1,Math.round(img.naturalWidth*scale));
    sourceHeight=Math.max(1,Math.round(img.naturalHeight*scale));

    sourceCanvas=document.createElement("canvas");
    sourceCanvas.width=sourceWidth;
    sourceCanvas.height=sourceHeight;
    sourceCanvas.getContext("2d").drawImage(img,0,0,sourceWidth,sourceHeight);

    stretchX.value=100;
    stretchY.value=100;
    setActiveRatio(null);
    render();
  };

  img.onerror=()=>{
    fileName.textContent="No se pudo abrir la imagen.";
    sourceCanvas=null;
    loadedFile=null;
  };

  img.src=objectUrl;
}

fileInput.addEventListener("change",()=>{
  const file=fileInput.files&&fileInput.files[0];
  if(file)loadFile(file);
});

[stretchX,stretchY].forEach(input=>input.addEventListener("input",render));

ratioButtons.forEach(button=>{
  button.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    stretchToRatio(Number(button.dataset.ratio));
  });
});

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

dropZone.addEventListener("drop",event=>{
  const file=event.dataTransfer.files&&event.dataTransfer.files[0];
  if(file)loadFile(file);
});

dropZone.addEventListener("click",event=>{
  if(event.target!==fileInput)fileInput.click();
});

download.addEventListener("click",()=>{
  if(!sourceCanvas)return;

  const x=Number(stretchX.value)/100;
  const y=Number(stretchY.value)/100;
  const width=Math.max(1,Math.round(sourceWidth*x));
  const height=Math.max(1,Math.round(sourceHeight*y));

  const output=document.createElement("canvas");
  output.width=width;
  output.height=height;
  const outputCtx=output.getContext("2d");
  outputCtx.imageSmoothingEnabled=true;
  outputCtx.drawImage(sourceCanvas,0,0,sourceWidth,sourceHeight,0,0,width,height);

  output.toBlob(blob=>{
    if(!blob)return;

    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.download="estirada-"+((loadedFile?.name||"imagen").replace(/\.[^.]+$/,""))+".png";
    a.href=url;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },"image/png");
});

reset.addEventListener("click",()=>{
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=null;
  loadedFile=null;
  sourceCanvas=null;
  sourceWidth=0;
  sourceHeight=0;

  fileInput.value="";
  canvas.width=1;
  canvas.height=1;
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  stretchX.value=100;
  stretchY.value=100;
  setActiveRatio(null);
  updateLabels();
  fileName.textContent="Ninguna imagen seleccionada · La imagen completa siempre se conserva.";
});

updateLabels();