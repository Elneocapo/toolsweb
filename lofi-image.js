const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const pixelSlider=document.getElementById("pixelSlider");
const glowSlider=document.getElementById("glowSlider");
const pixelValue=document.getElementById("pixelValue");
const glowValue=document.getElementById("glowValue");
const downloadBtn=document.getElementById("downloadBtn");
const resetBtn=document.getElementById("resetBtn");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");
let sourceImage=null;
let objectUrl=null;

function render(){
  if(!sourceImage)return;
  const maxWidth=1200;
  const scale=Math.min(1,maxWidth/sourceImage.naturalWidth);
  const w=Math.max(1,Math.round(sourceImage.naturalWidth*scale));
  const h=Math.max(1,Math.round(sourceImage.naturalHeight*scale));
  const px=Number(pixelSlider.value);
  const glow=Number(glowSlider.value)/100;

  canvas.width=w; canvas.height=h;

  const small=document.createElement("canvas");
  small.width=Math.max(1,Math.ceil(w/px));
  small.height=Math.max(1,Math.ceil(h/px));
  const sc=small.getContext("2d");
  sc.imageSmoothingEnabled=false;
  sc.drawImage(sourceImage,0,0,small.width,small.height);

  const base=document.createElement("canvas");
  base.width=w; base.height=h;
  const bc=base.getContext("2d");
  bc.imageSmoothingEnabled=false;
  bc.drawImage(small,0,0,w,h);

  ctx.clearRect(0,0,w,h);
  ctx.imageSmoothingEnabled=true;
  ctx.filter=`saturate(${1.28+glow*.35}) contrast(1.08) brightness(1.03)`;
  ctx.drawImage(base,0,0);

  // Soft glow layer: blurred copy with low opacity.
  if(glow>0){
    ctx.save();
    ctx.globalAlpha=.10+glow*.20;
    ctx.filter=`blur(${2+glow*8}px) saturate(1.5)`;
    ctx.drawImage(base,0,0);
    ctx.restore();
  }

  // Warm analog tint.
  ctx.save();
  ctx.globalAlpha=.08;
  ctx.fillStyle="#d8a06a";
  ctx.fillRect(0,0,w,h);
  ctx.restore();

  // Subtle vignette.
  const gradient=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.2,w/2,h/2,Math.max(w,h)*.72);
  gradient.addColorStop(0,"rgba(0,0,0,0)");
  gradient.addColorStop(1,"rgba(20,10,0,.20)");
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,w,h);

  pixelValue.textContent=px+" px";
  glowValue.textContent=Math.round(glow*100)+"%";
  placeholder.hidden=true;
  canvas.hidden=false;
  downloadBtn.disabled=false;
  resetBtn.disabled=false;
}

function loadFile(file){
  if(!file||!file.type.startsWith("image/"))return;
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    sourceImage=img;
    fileName.textContent=file.name;
    render();
    URL.revokeObjectURL(objectUrl);
    objectUrl=null;
  };
  img.src=objectUrl;
}

fileInput.addEventListener("change",()=>loadFile(fileInput.files[0]));
pixelSlider.addEventListener("input",render);
glowSlider.addEventListener("input",render);

["dragenter","dragover"].forEach(name=>dropZone.addEventListener(name,e=>{
  e.preventDefault();dropZone.classList.add("dragging");
}));
["dragleave","drop"].forEach(name=>dropZone.addEventListener(name,e=>{
  e.preventDefault();dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
dropZone.addEventListener("click",e=>{if(e.target!==fileInput)fileInput.click()});

downloadBtn.addEventListener("click",()=>{
  if(!sourceImage)return;
  const a=document.createElement("a");
  a.download="lofi-"+(fileName.textContent||"imagen.png").replace(/\.[^.]+$/,"")+".png";
  a.href=canvas.toDataURL("image/png");
  a.click();
});

resetBtn.addEventListener("click",()=>{
  sourceImage=null;
  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  downloadBtn.disabled=true;
  resetBtn.disabled=true;
  fileName.textContent="Ninguna imagen seleccionada";
  pixelSlider.value=6;
  glowSlider.value=35;
  pixelValue.textContent="6 px";
  glowValue.textContent="35%";
});