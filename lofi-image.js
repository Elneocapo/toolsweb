const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const pixelSlider=document.getElementById("pixelSlider");
const glowSlider=document.getElementById("glowSlider");
const ditherSlider=document.getElementById("ditherSlider");
const pixelValue=document.getElementById("pixelValue");
const glowValue=document.getElementById("glowValue");
const ditherValue=document.getElementById("ditherValue");
const downloadBtn=document.getElementById("downloadBtn");
const resetBtn=document.getElementById("resetBtn");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");
let sourceImage=null;
let objectUrl=null;

const bayer4=[
  [0,8,2,10],
  [12,4,14,6],
  [3,11,1,9],
  [15,7,13,5]
];

function applyDither(imageData,amount){
  if(amount<=0)return;
  const data=imageData.data;
  const strength=amount/100;
  const levels=4;
  for(let y=0;y<imageData.height;y++){
    for(let x=0;x<imageData.width;x++){
      const i=(y*imageData.width+x)*4;
      const threshold=(bayer4[y%4][x%4]/16-.5)*32*strength;
      for(let c=0;c<3;c++){
        const value=data[i+c];
        const shifted=Math.max(0,Math.min(255,value+threshold));
        const step=255/(levels-1);
        data[i+c]=Math.round(shifted/step)*step;
      }
    }
  }
}

function render(){
  if(!sourceImage)return;
  const maxWidth=1200;
  const scale=Math.min(1,maxWidth/sourceImage.naturalWidth);
  const w=Math.max(1,Math.round(sourceImage.naturalWidth*scale));
  const h=Math.max(1,Math.round(sourceImage.naturalHeight*scale));
  const px=Number(pixelSlider.value);
  const glow=Number(glowSlider.value)/100;
  const dither=Number(ditherSlider.value);

  canvas.width=w; canvas.height=h;

  const small=document.createElement("canvas");
  small.width=Math.max(1,Math.ceil(w/px));
  small.height=Math.max(1,Math.ceil(h/px));
  const sc=small.getContext("2d");
  sc.imageSmoothingEnabled=false;
  sc.drawImage(sourceImage,0,0,small.width,small.height);

  if(dither>0){
    const imageData=sc.getImageData(0,0,small.width,small.height);
    applyDither(imageData,dither);
    sc.putImageData(imageData,0,0);
  }

  const base=document.createElement("canvas");
  base.width=w; base.height=h;
  const bc=base.getContext("2d");
  bc.imageSmoothingEnabled=false;
  bc.drawImage(small,0,0,w,h);

  ctx.clearRect(0,0,w,h);
  ctx.imageSmoothingEnabled=true;
  ctx.filter=`saturate(${1.28+glow*.35}) contrast(1.08) brightness(1.03)`;
  ctx.drawImage(base,0,0);

  if(glow>0){
    ctx.save();
    ctx.globalAlpha=.10+glow*.20;
    ctx.filter=`blur(${2+glow*8}px) saturate(1.5)`;
    ctx.drawImage(base,0,0);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha=.08;
  ctx.fillStyle="#d8a06a";
  ctx.fillRect(0,0,w,h);
  ctx.restore();

  const gradient=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.2,w/2,h/2,Math.max(w,h)*.72);
  gradient.addColorStop(0,"rgba(0,0,0,0)");
  gradient.addColorStop(1,"rgba(20,10,0,.20)");
  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,w,h);

  pixelValue.textContent=px+" px";
  glowValue.textContent=Math.round(glow*100)+"%";
  ditherValue.textContent=Math.round(dither)+"%";
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
ditherSlider.addEventListener("input",render);

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
  ditherSlider.value=0;
  pixelValue.textContent="6 px";
  glowValue.textContent="35%";
  ditherValue.textContent="0%";
});