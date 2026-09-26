const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");
const pixelSlider = document.getElementById("pixelSlider");
const pixelValue = document.getElementById("pixelValue");
const downloadBtn = document.getElementById("downloadBtn");
const resetBtn = document.getElementById("resetBtn");
const placeholder = document.getElementById("canvasPlaceholder");
const previewWrap = document.getElementById("previewWrap");
const fileName = document.getElementById("fileName");
const status = document.getElementById("status");

let sourceImage = null;
let objectUrl = null;

function setStatus(message) {
  status.textContent = message;
}

function clampPixelSize(value) {
  return Math.max(2, Math.min(80, Number(value) || 2));
}

function render() {
  if (!sourceImage) return;

  const maxPreviewWidth = Math.min(previewWrap.clientWidth || 900, 1400);
  const scale = Math.min(1, maxPreviewWidth / sourceImage.naturalWidth);
  const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
  const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

  canvas.width = width;
  canvas.height = height;

  const pixelSize = clampPixelSize(pixelSlider.value);
  const smallWidth = Math.max(1, Math.ceil(width / pixelSize));
  const smallHeight = Math.max(1, Math.ceil(height / pixelSize));

  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = smallWidth;
  smallCanvas.height = smallHeight;
  const smallCtx = smallCanvas.getContext("2d");
  smallCtx.imageSmoothingEnabled = false;
  smallCtx.drawImage(sourceImage, 0, 0, smallWidth, smallHeight);

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(smallCanvas, 0, 0, width, height);

  pixelValue.textContent = pixelSize + " px";
  placeholder.hidden = true;
  canvas.hidden = false;
  downloadBtn.disabled = false;
  resetBtn.disabled = false;
  setStatus("Vista previa actualizada");
}

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Selecciona una imagen válida.");
    return;
  }

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    fileName.textContent = file.name;
    previewWrap.classList.add("has-image");
    render();
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
  img.onerror = () => setStatus("No se pudo cargar la imagen.");
  img.src = objectUrl;
}

fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
pixelSlider.addEventListener("input", render);

["dragenter", "dragover"].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", event => loadFile(event.dataTransfer.files[0]));

dropZone.addEventListener("click", event => {
  if (event.target !== fileInput) fileInput.click();
});

downloadBtn.addEventListener("click", () => {
  if (!sourceImage) return;
  const link = document.createElement("a");
  link.download = "pixelado-" + (fileName.textContent || "imagen.png").replace(/\.[^.]+$/, "") + ".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  setStatus("Imagen descargada con el mismo pixelado de la vista previa.");
});

resetBtn.addEventListener("click", () => {
  sourceImage = null;
  fileInput.value = "";
  canvas.hidden = true;
  placeholder.hidden = false;
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  fileName.textContent = "Ninguna imagen seleccionada";
  pixelSlider.value = 12;
  pixelValue.textContent = "12 px";
  previewWrap.classList.remove("has-image");
  setStatus("Listo para otra imagen.");
});
window.NeoGif.register({
  fileInput,dropZone,download:downloadBtn,reset:resetBtn,canvas,ctx,placeholder,fileName,maxSide:1400,
  renderFrame(frame){
    const previous=sourceImage;
    frame.naturalWidth=frame.width;
    frame.naturalHeight=frame.height;
    sourceImage=frame;
    render();
    const out=document.createElement("canvas");
    out.width=canvas.width;out.height=canvas.height;
    out.getContext("2d").drawImage(canvas,0,0);
    sourceImage=previous;
    return out;
  }
});
