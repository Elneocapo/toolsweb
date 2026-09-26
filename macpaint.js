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

const MAX_SIDE=1000;
const PATTERN_WORDS=`FFFF FFFF FFFF FFFF DDFF 77FF DDFF 77FF DD77 DD77 DD77 DD77 DD77 AA55 AA55 AA55 AA55 55FF 55FF 55FF 55FF AAAA AAAA AAAA AAAA EEDD BB77 EEDD BB77 8888 8888 8888 8888 B130 031B D8C0 0C8D 8010 0220 0108 4004 FF88 8888 FF88 8888 FF80 8080 FF08 0808 8000 0000 0000 0000 8040 2000 0204 0800 8244 3944 8201 0101 F874 2247 8F17 2271 55A0 4040 550A 0404 2050 8888 8888 0502 BF00 BFBF B0B0 B0B0 0000 0000 0000 0000 8000 0800 8000 0800 8800 2200 8800 2200 8822 8822 8822 8822 AA00 AA00 AA00 AA00 FF00 FF00 FF00 FF00 1122 4488 1122 4488 FF00 0000 FF00 0000 0102 0408 1020 4080 AA00 8000 8800 8000 FF80 8080 8080 8080 081C 22C1 8001 0204 8814 2241 8800 AA00 40A0 0000 040A 0000 0384 4830 0C02 0101 8080 413E 0808 14E3 1020 54AA FF02 0408 7789 8F8F 7798 F8F8 0008 142A 552A 1408`.split(/\s+/);

let image=null;
let objectUrl=null;
let sourceCanvas=null;
let sourceCtx=null;
let sourceData=null;
let enabledPatterns=new Array(38).fill(true);
let patternBits=[];
let patternDensity=[];
let renderTimer=0;
let renderVersion=0;

function clamp(v){return Math.max(0,Math.min(255,v));}

function hexToRgb(hex){
  const n=parseInt(hex.slice(1),16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}

function parsePatterns(){
  patternBits=[];
  patternDensity=[];

  for(let p=0;p<38;p++){
    const bits=[];
    for(let wordIndex=0;wordIndex<4;wordIndex++){
      const word=parseInt(PATTERN_WORDS[p*4+wordIndex],16);
      for(let bit=15;bit>=0;bit--)bits.push((word>>bit)&1);
    }
    patternBits.push(bits);
    patternDensity.push(bits.reduce((sum,v)=>sum+v,0)/64);
  }
}

function buildPatternRamp(){
  const order=[...Array(38).keys()].sort((a,b)=>patternDensity[a]-patternDensity[b]);
  patternGrid.innerHTML="";

  for(const index of order){
    const button=document.createElement("button");
    button.type="button";
    button.className="pattern";
    button.title="Patrón "+(index+1);

    const c=document.createElement("canvas");
    c.width=32;
    c.height=32;
    const pctx=c.getContext("2d");
    pctx.fillStyle="#fff";
    pctx.fillRect(0,0,32,32);
    pctx.fillStyle="#000";

    const bits=patternBits[index];
    for(let y=0;y<8;y++){
      for(let x=0;x<8;x++){
        if(bits[y*8+x])pctx.fillRect(x*4,y*4,4,4);
      }
    }

    button.appendChild(c);
    button.onclick=()=>{
      const active=enabledPatterns.filter(Boolean).length;
      if(enabledPatterns[index]&&active===1)return;
      enabledPatterns[index]=!enabledPatterns[index];
      button.classList.toggle("off",!enabledPatterns[index]);
      scheduleRender();
    };

    patternGrid.appendChild(button);
  }
}

function blurSmall(input,w,h,amount){
  if(amount<=0)return input;

  const radius=Math.max(1,Math.round(amount*2));
  const tmp=new Float32Array(input.length);
  const out=new Float32Array(input.length);

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      let sum=0,count=0;
      for(let dx=-radius;dx<=radius;dx++){
        const xx=Math.max(0,Math.min(w-1,x+dx));
        sum+=input[y*w+xx];
        count++;
      }
      tmp[y*w+x]=sum/count;
    }
  }

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      let sum=0,count=0;
      for(let dy=-radius;dy<=radius;dy++){
        const yy=Math.max(0,Math.min(h-1,y+dy));
        sum+=tmp[yy*w+x];
        count++;
      }
      out[y*w+x]=sum/count;
    }
  }

  return out;
}

function sharpenSmall(input,w,h,amount){
  if(amount===0)return input;

  const blur=blurSmall(input,w,h,1);
  const out=new Float32Array(input.length);
  const strength=amount/100;

  for(let i=0;i<input.length;i++){
    out[i]=strength>0
      ? clamp(input[i]+(input[i]-blur[i])*1.5*strength)
      : clamp(input[i]*(1+strength)+blur[i]*(-strength));
  }

  return out;
}

function addGrain(input,amount){
  if(amount<=0)return input;

  const out=new Float32Array(input.length);
  const strength=amount*.75;

  for(let i=0;i<input.length;i++){
    out[i]=clamp(input[i]+(Math.random()*2-1)*strength);
  }

  return out;
}

function applyContrast(input,amount){
  if(amount===0)return input;

  const out=new Float32Array(input.length);
  const factor=1+amount/100;

  for(let i=0;i<input.length;i++){
    out[i]=clamp((input[i]-128)*factor+128);
  }

  return out;
}

function pickPattern(tone){
  const target=1-tone/255;
  let best=0;
  let distance=Infinity;

  for(let i=0;i<38;i++){
    if(!enabledPatterns[i])continue;
    const d=Math.abs(patternDensity[i]-target);
    if(d<distance){
      distance=d;
      best=i;
    }
  }

  return best;
}

function render(){
  if(!image||!sourceData)return;

  const myVersion=++renderVersion;
  const sourceW=canvas.width;
  const sourceH=canvas.height;

  const longer=Math.max(sourceW,sourceH);
  const requested=Math.max(24,Math.min(320,Number(bitmapWidth.value)));

  let cols,rows;
  if(sourceW>=sourceH){
    cols=requested;
    rows=Math.max(1,Math.round(requested*sourceH/sourceW));
  }else{
    rows=requested;
    cols=Math.max(1,Math.round(requested*sourceW/sourceH));
  }

  const small=document.createElement("canvas");
  small.width=cols;
  small.height=rows;

  const sctx=small.getContext("2d",{willReadFrequently:true});
  sctx.imageSmoothingEnabled=true;
  sctx.drawImage(sourceCanvas,0,0,cols,rows);

  const pixels=sctx.getImageData(0,0,cols,rows).data;
  let tone=new Float32Array(cols*rows);

  for(let i=0,p=0;i<pixels.length;i+=4,p++){
    tone[p]=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
  }

  const smoothAmount=Number(smooth.value)/100;
  const sharpenAmount=Number(sharpen.value);
  const grainAmount=Number(grain.value);
  const contrastAmount=Number(contrast.value);
  const thresholdAmount=Number(threshold.value)*2.55;

  if(smoothAmount>0)tone=blurSmall(tone,cols,rows,smoothAmount);
  if(sharpenAmount!==0)tone=sharpenSmall(tone,cols,rows,sharpenAmount);
  if(contrastAmount!==0)tone=applyContrast(tone,contrastAmount);
  if(grainAmount>0)tone=addGrain(tone,grainAmount);

  const edgeMode=edge.value;
  const edgeStrength=Number(edgeAmount.value)/100;

  const inkRgb=hexToRgb(ink.value);
  const paperRgb=hexToRgb(paper.value);
  const blendAmount=Number(blend.value)/100;

  const out=new Uint8ClampedArray(sourceData.length);

  // Start from paper, then stamp the selected 8x8 pattern into each cell.
  for(let i=0;i<out.length;i+=4){
    out[i]=paperRgb[0];
    out[i+1]=paperRgb[1];
    out[i+2]=paperRgb[2];
    out[i+3]=sourceData[i+3];
  }

  for(let cy=0;cy<rows;cy++){
    for(let cx=0;cx<cols;cx++){
      let value=clamp(tone[cy*cols+cx]+thresholdAmount);

      if(edgeMode!=="off"){
        const left=tone[cy*cols+Math.max(0,cx-1)];
        const right=tone[cy*cols+Math.min(cols-1,cx+1)];
        const up=tone[Math.max(0,cy-1)*cols+cx];
        const down=tone[Math.min(rows-1,cy+1)*cols+cx];
        const edgeValue=Math.min(255,Math.hypot(right-left,down-up)*1.7);

        if(edgeMode==="shade")value=clamp(value-edgeValue*edgeStrength);
      }

      const patternIndex=pickPattern(value);
      const bits=patternBits[patternIndex];

      const x0=Math.floor(cx*sourceW/cols);
      const x1=Math.min(sourceW,Math.max(x0+1,Math.ceil((cx+1)*sourceW/cols)));
      const y0=Math.floor(cy*sourceH/rows);
      const y1=Math.min(sourceH,Math.max(y0+1,Math.ceil((cy+1)*sourceH/rows)));

      for(let y=y0;y<y1;y++){
        const py=Math.min(7,Math.floor((y-y0)*8/(y1-y0)));

        for(let x=x0;x<x1;x++){
          const px=Math.min(7,Math.floor((x-x0)*8/(x1-x0)));
          let isInk=bits[py*8+px]===1;

          if(edgeMode==="ink"){
            const left=tone[cy*cols+Math.max(0,cx-1)];
            const right=tone[cy*cols+Math.min(cols-1,cx+1)];
            const up=tone[Math.max(0,cy-1)*cols+cx];
            const down=tone[Math.min(rows-1,cy+1)*cols+cx];
            const edgeValue=Math.min(255,Math.hypot(right-left,down-up)*1.7);
            if(edgeValue*edgeStrength>70)isInk=true;
          }

          const i=(y*sourceW+x)*4;
          const target=isInk?inkRgb:paperRgb;

          out[i]=Math.round(target[0]*blendAmount+sourceData[i]*(1-blendAmount));
          out[i+1]=Math.round(target[1]*blendAmount+sourceData[i+1]*(1-blendAmount));
          out[i+2]=Math.round(target[2]*blendAmount+sourceData[i+2]*(1-blendAmount));
          out[i+3]=sourceData[i+3];
        }
      }
    }

    if(myVersion!==renderVersion)return;
  }

  ctx.putImageData(new ImageData(out,sourceW,sourceH),0,0);

  bitmapWidthValue.textContent=requested;
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

function scheduleRender(){
  if(!image)return;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    renderTimer=0;
    requestAnimationFrame(render);
  },25);
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;

  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file);

  const img=new Image();

  img.onload=()=>{
    try{
      const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
      const w=Math.max(1,Math.round(img.naturalWidth*scale));
      const h=Math.max(1,Math.round(img.naturalHeight*scale));

      canvas.width=w;
      canvas.height=h;

      sourceCanvas=document.createElement("canvas");
      sourceCanvas.width=w;
      sourceCanvas.height=h;
      sourceCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});
      sourceCtx.drawImage(img,0,0,w,h);
      sourceData=new Uint8ClampedArray(sourceCtx.getImageData(0,0,w,h).data);

      image=img;
      fileName.textContent=file.name+" · Procesado en tu navegador.";

      render();
    }catch(error){
      console.error("MacPaint load:",error);
      image=null;
    }
  };

  img.onerror=()=>{
    console.error("MacPaint: no se pudo cargar la imagen.");
  };

  img.src=objectUrl;
}

fileInput.onchange=()=>load(fileInput.files[0]);

[bitmapWidth,threshold,contrast,grain,smooth,sharpen,edgeAmount,blend].forEach(input=>{
  input.addEventListener("input",scheduleRender);
});

edge.addEventListener("change",scheduleRender);
ink.addEventListener("input",scheduleRender);
paper.addEventListener("input",scheduleRender);

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
  renderVersion++;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=0;

  if(objectUrl){
    URL.revokeObjectURL(objectUrl);
    objectUrl=null;
  }

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
  document.querySelectorAll(".pattern").forEach(button=>button.classList.remove("off"));
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

parsePatterns();
buildPatternRamp();
updateLabels();
