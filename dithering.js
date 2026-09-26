const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),amount=document.getElementById("amount"),size=document.getElementById("size"),amountValue=document.getElementById("amountValue"),sizeValue=document.getElementById("sizeValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null;
const bayer4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const bayer8=[
[0,48,12,60,3,51,15,63],[32,16,44,28,35,19,47,31],[8,56,4,52,11,59,7,55],[40,24,36,20,43,27,39,23],
[2,50,14,62,1,49,13,61],[34,18,46,30,33,17,45,29],[10,58,6,54,9,57,5,53],[42,26,38,22,41,25,37,21]
];
function getMatrix(n){return n===2?[[0,2],[3,1]]:n===8?bayer8:bayer4}
function render(){
 if(!image)return;
 const max=1400,w=Math.min(image.naturalWidth,max),h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));
 canvas.width=w;canvas.height=h;ctx.drawImage(image,0,0,w,h);
 const src=ctx.getImageData(0,0,w,h),out=new ImageData(w,h),a=src.data,o=out.data;
 const strength=+amount.value/100,n=+size.value,m=getMatrix(n),levels=2;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const lum=(a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722)/255;
  const threshold=(m[y%n][x%n]+.5)/(n*n);
  const dithered=lum>=threshold?255:0;
  for(let c=0;c<3;c++)o[i+c]=Math.round(a[i+c]*(1-strength)+dithered*strength);
  o[i+3]=a[i+3];
 }
 ctx.putImageData(out,0,0);
 amountValue.textContent=amount.value+"%";sizeValue.textContent=n+"×"+n;
 placeholder.hidden=true;canvas.hidden=false;download.disabled=false;reset.disabled=false;
}
function load(file){if(!file||!file.type.startsWith("image/"))return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{image=img;fileName.textContent=file.name+" · Procesado en tu navegador.";render()};img.src=url}
fileInput.onchange=()=>load(fileInput.files[0]);amount.oninput=render;size.oninput=render;
["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.onclick=e=>{if(e.target!==fileInput)fileInput.click()};dropZone.ondrop=e=>load(e.dataTransfer.files[0]);
download.onclick=()=>{const a=document.createElement("a");a.download="dithering.png";a.href=canvas.toDataURL("image/png");a.click()};
reset.onclick=()=>{image=null;fileInput.value="";canvas.hidden=true;placeholder.hidden=false;download.disabled=true;reset.disabled=true;fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador."};