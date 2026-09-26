const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const bitmapWidth=document.getElementById("bitmapWidth");
const threshold=document.getElementById("threshold");
const contrast=document.getElementById("contrast");
const grain=document.getElementById("grain");
const smooth=document.getElementById("smooth");
const sharpen=document.getElementById("sharpen");
const edge=document.getElementById("edge");
const edgeAmount=document.getElementById("edgeAmount");
const blend=document.getElementById("blend");
const ink=document.getElementById("ink");
const paper=document.getElementById("paper");
const bitmapWidthValue=document.getElementById("bitmapWidthValue");
const thresholdValue=document.getElementById("thresholdValue");
const contrastValue=document.getElementById("contrastValue");
const grainValue=document.getElementById("grainValue");
const smoothValue=document.getElementById("smoothValue");
const sharpenValue=document.getElementById("sharpenValue");
const edgeAmountValue=document.getElementById("edgeAmountValue");
const blendValue=document.getElementById("blendValue");
const patternGrid=document.getElementById("patternGrid");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

let image=null;
let objectUrl=null;
let sourceCanvas=null;
let sourceCtx=null;
let sourceData=null;
let enabledPatterns=new Array(38).fill(true);
let patternBits=[];
let patternDensity=[];

const MAX_SIDE=1000;

const rawPatternWords=`FFFF FFFF FFFF FFFF DDFF 77FF DDFF 77FF DD77 DD77 DD77 DD77 DD77 AA55 AA55 AA55 AA55 55FF 55FF 55FF 55FF AAAA AAAA AAAA AAAA EEDD BB77 EEDD BB77 8888 8888 8888 8888 B130 031B D8C0 0C8D 8010 0220 0108 4004 FF88 8888 FF88 8888 FF80 8080 FF08 0808 8000 0000 0000 0000 8040 2000 0204 0800 8244 3944 8201 0101 F874 2247 8F17 2271 55A0 4040 550A 0404 2050 8888 8888 0502 BF00 BFBF B0B0 B0B0 0000 0000 0000 0000 8000 0800 8000 0800 8800 2200 8800 2200 8822 8822 8822 8822 AA00 AA00 AA00 AA00 FF00 FF00 FF00 FF00 1122 4488 1122 4488 FF00 0000 FF00 0000 0102 0408 1020 4080 AA00 8000 8800 8000 FF80 8080 8080 8080 081C 22C1 8001 0204 8814 2241 8800 AA00 40A0 0000 040A 0000 0384 4830 0C02 0101 8080 413E 0808 14E3 1020 54AA FF02 0408 7789 8F8F 7798 F8F8 0008 142A 552A 1408`.split(/\s+/);
for(let p=0;p<38;p++){
  const bits=[];
  let ones=0;
  for(let row=0;row<4;row++){
    const word=parseInt(rawPatternWords[p*4+row],16);
    for(let bit=15;bit>=0;bit--){
      bits.push((word>>bit)&1);
    }
  }
  patternBits.push(bits);
  ones=bits.reduce((sum,v)=>sum+v,0);
  patternDensity.push(ones/64);
}

const sortedPatternIndices=[...Array(38).keys()].sort((a,b)=>patternDensity[a]-patternDensity[b]);

function makePatternPreview(index){
  const c=document.createElement("canvas");
  c.width=32;c.height=32;
  const x=c.getContext("2d");
  const bits=patternBits[index];
  x.fillStyle="#fff";
  x.fillRect(0,0,32,32);
  x.fillStyle="#000";
  for(let y=0;y<8;y++){
    for(let xx=0;xx<8;xx++){
      if(bits[y*8+xx])x.fillRect(xx*4,y*4,4,4);
    }
  }
  return c;
}

function buildPatternRamp(){
  patternGrid.innerHTML="";
  sortedPatternIndices.forEach(index=>{
    const button=document.createElement("button");
    button.className="pattern";
    button.type="button";
    button.title="Patrón "+(index+1);
    button.dataset.index=index;
    button.appendChild(makePatternPreview(index));
    button.onclick=()=>{
      const active=enabledPatterns.filter(Boolean).length;
      if(enabledPatterns[index]&&active===1)return;
      enabledPatterns[index]=!enabledPatterns[index];
      button.classList.toggle("off",!enabledPatterns[index]);
      scheduleRender();
    };
    patternGrid.appendChild(button);
  });
}

function clamp(v){return Math.max(0,Math.min(255,v));}

function hexToRgb(hex){
  const n=parseInt(hex.slice(1),16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}

function blurGray(input,w,h,amount){
  if(amount<=0)return input;
  const radius=Math.max(1,Math.round(amount*3));
  const temp=new Float32Array(input.length);
  const out=new Float32Array(input.length);

  for(let y=0;y<h;y++){
    let sum=0;
    for(let x=-radius;x<=radius;x++){
      sum+=input[y*w+Math.max(0,Math.min(w-1,x))];
    }
    for(let x=0;x<w;x++){
      temp[y*w+x]=sum/(radius*2+1);
      const remove=x-radius;
      const add=x+radius+1;
      sum-=input[y*w+Math.max(0,Math.min(w-1,remove))];
      sum+=input[y*w+Math.max(0,Math.min(w-1,add))];
    }
  }

  for(let x=0;x<w;x++){
    let sum=0;
    for(let y=-radius;y<=radius;y++)sum+=temp[Math.max(0,Math.min(h-1,y))*w+x];
    for(let y=0;y<h;y++){
      out[y*w+x]=sum/(radius*2+1);
      const remove=y-radius;
      const add=y+radius+1;
      sum-=temp[Math.max(0,Math.min(h-1,remove))*w+x];
      sum+=temp[Math.max(0,Math.min(h-1,add))*w+x];
    }
  }
  return out;
}

function sharpenGray(input,w,h,amount){
  if(amount===0)return input;
  const blur=blurGray(input,w,h,Math.min(1,Math.abs(amount)/100));
  const out=new Float32Array(input.length);
  const strength=amount/100;
  for(let i=0;i<input.length;i++){
    if(strength>0)out[i]=clamp(input[i]+(input[i]-blur[i])*(strength*1.8));
    else out[i]=clamp(input[i]*(1+strength)+blur[i]*(-strength));
  }
  return out;
}

function addGrain(input,amount){
  if(amount<=0)return input;
  const out=new Float32Array(input.length);
  const strength=amount*0.55;
  for(let i=0;i<input.length;i++){
    const noise=(Math.random()*2-1)*strength;
    out[i]=clamp(input[i]+noise);
  }
  return out;
}

function applyContrast(input,amount){
  if(amount===0)return input;
  const out=new Float32Array(input.length);
  const c=(amount/100)+1;
  for(let i=0;i<input.length;i++){
    out[i]=clamp((input[i]-128)*c+128);
  }
  return out;
}

function sampleGrayscale(data,w,h,cx,cy,cellW,cellH){
  const x0=Math.max(0,Math.floor(cx*cellW));
  const x1=Math.min(w,Math.max(x0+1,Math.ceil((cx+1)*cellW)));
  const y0=Math.max(0,Math.floor(cy*cellH));
  const y1=Math.min(h,Math.max(y0+1,Math.ceil((cy+1)*cellH)));
  let sum=0,count=0;
  for(let y=y0;y<y1;y++){
    for(let x=x0;x<x1;x++){
      sum+=0.2126*data[(y*w+x)*4]+0.7152*data[(y*w+x)*4+1]+0.0722*data[(y*w+x)*4+2];
      count++;
    }
  }
  return count?sum/count:255;
}

function pickPattern(tone){
  const target=1-tone/255;
  let bestIndex=sortedPatternIndices[0];
  let best=Infinity;

  for(const index of sortedPatternIndices){
    if(!enabledPatterns[index])continue;
    const d=Math.abs(patternDensity[index]-target);
    if(d<best){
      best=d;
      bestIndex=index;
    }
  }

  return bestIndex;
}

function buildLowResGrayscale(data,w,h,cellW,cellH){
  const cols=Math.ceil(w/cellW);
  const rows=Math.ceil(h/cellH);
  const small=new Float32Array(cols*rows);

  for(let cy=0;cy<rows;cy++){
    for(let cx=0;cx<cols;cx++){
      small[cy*cols+cx]=sampleGrayscale(data,w,h,cx,cy,cellW,cellH);
    }
  }
  return {small,cols,rows};
}

function render(){
  if(!image||!sourceData)return;

  const id=++render._id;
  const max=MAX_SIDE;
  const w=Math.min(image.naturalWidth,max);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));

  if(canvas.width!==w||canvas.height!==h){
    canvas.width=w;
    canvas.height=h;
  }

  const widthCells=Math.max(8,Math.min(Number(bitmapWidth.value),Math.max(8,Math.round(Math.max(w,h)))));
  const cell=Math.max(1,Math.max(w,h)/widthCells);
  const cellW=cell;
  const cellH=cell;
  const smoothAmount=Number(smooth.value)/100;
  const sharpenAmount=Number(sharpen.value);
  const grainAmount=Number(grain.value);
  const contrastAmount=Number(contrast.value);
  const thresholdAmount=Number(threshold.value)/100;
  const selectedEdge=edge.value;
  const edgeStrength=Number(edgeAmount.value)/100;
  const blendAmount=Number(blend.value)/100;

  let toneData=buildLowResGrayscale(sourceData,w,h,cellW,cellH);
  let small=toneData.small;

  if(smoothAmount>0)small=blurGray(small,toneData.cols,toneData.rows,smoothAmount);
  if(sharpenAmount!==0)small=sharpenGray(small,toneData.cols,toneData.rows,sharpenAmount);
  if(contrastAmount!==0)small=applyContrast(small,contrastAmount);
  if(grainAmount>0)small=addGrain(small,grainAmount);

  const out=new Uint8ClampedArray(sourceData);
  const inkRgb=hexToRgb(ink.value);
  const paperRgb=hexToRgb(paper.value);

  for(let cy=0;cy<toneData.rows;cy++){
    for(let cx=0;cx<toneData.cols;cx++){
      let tone=small[cy*toneData.cols+cx];

      tone=clamp(tone+(thresholdAmount*255));
      let edgeValue=0;

      if(selectedEdge!=="off"){
        const left=small[cy*toneData.cols+Math.max(0,cx-1)];
        const right=small[cy*toneData.cols+Math.min(toneData.cols-1,cx+1)];
        const up=small[Math.max(0,cy-1)*toneData.cols+cx];
        const down=small[Math.min(toneData.rows-1,cy+1)*toneData.cols+cx];
        edgeValue=Math.min(255,Math.hypot(right-left,down-up)*1.6);
      }

      if(selectedEdge==="shade")tone=clamp(tone-edgeValue*edgeStrength);
      const patternIndex=pickPattern(tone);
      const bits=patternBits[patternIndex];

      const x0=Math.floor(cx*cellW);
      const x1=Math.min(w,Math.max(x0+1,Math.ceil((cx+1)*cellW)));
      const y0=Math.floor(cy*cellH);
      const y1=Math.min(h,Math.max(y0+1,Math.ceil((cy+1)*cellH)));

      for(let y=y0;y<y1;y++){
        const py=Math.min(7,Math.floor(((y-y0)/(y1-y0))*8));
        for(let x=x0;x<x1;x++){
          const px=Math.min(7,Math.floor(((x-x0)/(x1-x0))*8));
          let isInk=bits[py*8+px]===1;

          if(selectedEdge==="ink"&&edgeValue>0){
            const edgeMask=Math.min(1,edgeValue/80)*edgeStrength;
            if(edgeMask>0.5)isInk=true;
          }

          const i=(y*w+x)*4;
          const target=isInk?inkRgb:paperRgb;
          const b=blendAmount;
          out[i]=Math.round(sourceData[i]*(1-b)+target[0]*b);
          out[i+1]=Math.round(sourceData[i+1]*(1-b)+target[1]*b);
          out[i+2]=Math.round(sourceData[i+2]*(1-b)+target[2]*b);
          out[i+3]=sourceData[i+3];
        }
      }
    }
  }

  if(id!==render._id)return;

  ctx.putImageData(new ImageData(out,w,h),0,0);
  bitmapWidthValue.textContent=widthCells;
  thresholdValue.textContent=(Number(threshold.value)>0?"+":"")+threshold.value+"%";
  contrastValue.textContent=(Number(contrast.value)>0?"+":"")+contrast.value+"%";
  grainValue.textContent=grain.value+"%";
  smoothValue.textContent=smooth.value+"%";
  sharpenValue.textContent=(Number(sharpen.value)>0?"+":"")+sharpen.value+"%";
  edgeAmountValue.textContent=edgeAmount.value+"%";
  blendValue.textContent=blend.value+"%";

  canvas.hidden=false;
  placeholder.hidden=true;
  download.disabled=false;
  reset.disabled=false;
}

render._id=0;
let timer=0;
function scheduleRender(){
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{
    timer=0;
    render();
  },35);
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file);
  const img=new Image();

  img.onload=()=>{
    image=img;
    sourceCanvas=document.createElement("canvas");
    const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale));
    const h=Math.max(1,Math.round(img.naturalHeight*scale));
    sourceCanvas.width=w;
    sourceCanvas.height=h;
    sourceCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});
    sourceCtx.drawImage(img,0,0,w,h);
    sourceData=new Uint8ClampedArray(sourceCtx.getImageData(0,0,w,h).data);
    fileName.textContent=file.name+" · Procesado en tu navegador.";
    render();
  };

  img.src=objectUrl;
}

fileInput.onchange=()=>load(fileInput.files[0]);
[bitmapWidth,threshold,contrast,grain,smooth,sharpen,edgeAmount,blend].forEach(el=>el.addEventListener("input",scheduleRender));
edge.addEventListener("change",scheduleRender);
ink.addEventListener("input",scheduleRender);
paper.addEventListener("input",scheduleRender);

["dragenter","dragover"].forEach(name=>dropZone.addEventListener(name,e=>{
  e.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave","drop"].forEach(name=>dropZone.addEventListener(name,e=>{
  e.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.onclick=e=>{
  if(e.target!==fileInput)fileInput.click();
};
dropZone.ondrop=e=>load(e.dataTransfer.files[0]);

download.onclick=()=>{
  if(!canvas.width||!canvas.height)return;
  const a=document.createElement("a");
  a.download="macpaint.png";
  a.href=canvas.toDataURL("image/png");
  a.click();
};

reset.onclick=()=>{
  image=null;
  sourceCanvas=null;
  sourceCtx=null;
  sourceData=null;
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  bitmapWidth.value=128;
  threshold.value=0;
  contrast.value=0;
  grain.value=0;
  smooth.value=0;
  sharpen.value=0;
  edge.value="off";
  edgeAmount.value=50;
  blend.value=100;
  ink.value="#000000";
  paper.value="#ffffff";
  enabledPatterns.fill(true);
  document.querySelectorAll(".pattern").forEach(x=>x.classList.remove("off"));
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
  updateLabels();
};

function updateLabels(){
  bitmapWidthValue.textContent=bitmapWidth.value;
  thresholdValue.textContent=(Number(threshold.value)>0?"+":"")+threshold.value+"%";
  contrastValue.textContent=(Number(contrast.value)>0?"+":"")+contrast.value+"%";
  grainValue.textContent=grain.value+"%";
  smoothValue.textContent=smooth.value+"%";
  sharpenValue.textContent=(Number(sharpen.value)>0?"+":"")+sharpen.value+"%";
  edgeAmountValue.textContent=edgeAmount.value+"%";
  blendValue.textContent=blend.value+"%";
}

buildPatternRamp();
updateLabels();
