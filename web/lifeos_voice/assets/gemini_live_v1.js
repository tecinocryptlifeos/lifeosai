/* LIFEOS_VOICE_HEADER_STATUS_REFINEMENT_V1 */
/* LIFEOS_GOLDEN_VOICE_VISUALIZER_V5 */
/* LIFEOS_VOICE_FINAL_TOUCHES_V4 */
/* LIFEOS_VOICE_BACKGROUND_VOLUME_REPAIR_V1 */
/* LIFEOS_IDENTITY_ATTRIBUTION_UPGRADE_V2 */
/* LIFEOS_SYNTHETIC_INTELLIGENCE_IDENTITY_LOCK_V1 */
/* LIFEOS_GEMINI_LIVE_V1 */
/* LIFEOS_GEMINI_LIVE_INTERFACE_AUDIO_V2 */
(function(){
"use strict";
const INPUT_RATE=16000;
const OUTPUT_RATE=24000;
const liveButton=document.getElementById("liveButton");
const micButton=document.getElementById("micButton");
const speakerButton=document.getElementById("speakerButton");
const outputButton=document.getElementById("outputButton");
const outputLabel=document.getElementById("outputLabel");
const statusBox=document.getElementById("status");
const orb=document.getElementById("orb");
const audioElement=document.getElementById("sophiaAudio");

let socket=null,micStream=null,inputContext=null,inputSource=null,processor=null,muteGain=null;
let outputContext=null,outputDestination=null,outputGain=null,outputCompressor=null,nextOutputTime=0;
let outputSources=new Set();
let starting=false,active=false,setupReady=false,closingNormally=false;
let micMuted=false,speakerEnabled=true,selectedSinkId="default",selectedSinkLabel="phone default";

function setStatus(text,state){
  statusBox.textContent=text;
  statusBox.classList.toggle("active",state==="active");
  statusBox.classList.toggle("error",state==="error");
  orb.classList.toggle("active",state==="active");
  liveButton.disabled=starting;
  liveButton.textContent=active?"End Live Conversation":"Start Live Conversation";
  micButton.disabled=!active;
  speakerButton.disabled=!active;
}

function refreshControls(){
  micButton.textContent=micMuted?"Unmute":"Mute";
  micButton.classList.toggle("active",!micMuted);
  micButton.classList.toggle("warn",micMuted);
  speakerButton.textContent=speakerEnabled?"Speaker On":"Speaker Off";
  speakerButton.classList.toggle("active",speakerEnabled);
  speakerButton.classList.toggle("warn",!speakerEnabled);
  outputLabel.textContent="Output: "+selectedSinkLabel;
}

function bytesToBase64(bytes){
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=8192){
    binary+=String.fromCharCode.apply(null,bytes.subarray(offset,offset+8192));
  }
  return btoa(binary);
}

function base64ToBytes(value){
  const binary=atob(value);
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function resampleToPcm16(input,sourceRate){
  const ratio=sourceRate/INPUT_RATE;
  const outputLength=Math.max(1,Math.floor(input.length/ratio));
  const output=new Int16Array(outputLength);
  for(let outputIndex=0;outputIndex<outputLength;outputIndex+=1){
    const start=Math.floor(outputIndex*ratio);
    const end=Math.min(input.length,Math.floor((outputIndex+1)*ratio));
    let total=0,count=0;
    for(let inputIndex=start;inputIndex<end;inputIndex+=1){total+=input[inputIndex];count+=1;}
    const value=Math.max(-1,Math.min(1,count?total/count:input[start]||0));
    output[outputIndex]=value<0?value*32768:value*32767;
  }
  return output;
}

/* LIFEOS_ANDROID_DEFAULT_AUDIO_FALLBACK_V1 */
async function applySelectedOutput(){
  /*
   * The browser automatically uses the operating system's normal audio
   * destination when no explicit sink is selected. Some Android browsers
   * expose setSinkId() but reject the literal device ID "default".
   */
  if(selectedSinkId==="default"){
    selectedSinkLabel="phone default";
    refreshControls();
    return true;
  }

  try{
    if(audioElement&&typeof audioElement.setSinkId==="function"){
      await audioElement.setSinkId(selectedSinkId);
    }else if(outputContext&&typeof outputContext.setSinkId==="function"){
      await outputContext.setSinkId(selectedSinkId);
    }else{
      throw new Error("This browser does not permit audio-output selection.");
    }
  }catch(error){
    console.warn(
      "LifeOS audio-output selection unavailable; using system default.",
      error
    );
    selectedSinkId="default";
    selectedSinkLabel="phone default";
    refreshControls();
    return false;
  }

  refreshControls();
  return true;
}

async function preferPhoneSpeaker(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return;
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const outputs=devices.filter(device=>device.kind==="audiooutput");
    const speaker=outputs.find(device=>/speaker|loudspeaker|media/i.test(device.label||""));
    if(speaker){
      selectedSinkId=speaker.deviceId;
      selectedSinkLabel=speaker.label||"phone speaker";
    }else{
      selectedSinkId="default";
      selectedSinkLabel="phone default";
    }
    await applySelectedOutput();
  }catch(error){
    selectedSinkId="default";
    selectedSinkLabel="phone default";
    refreshControls();
  }
}

async function chooseAudioOutput(){
  outputButton.disabled=true;
  try{
    await ensureOutputContext();
    if(navigator.mediaDevices&&typeof navigator.mediaDevices.selectAudioOutput==="function"){
      const device=await navigator.mediaDevices.selectAudioOutput();
      selectedSinkId=device.deviceId;
      selectedSinkLabel=device.label||"selected device";
      await applySelectedOutput();
      setStatus("Audio output updated.",active?"active":"");
      return;
    }
    if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices){
      const devices=await navigator.mediaDevices.enumerateDevices();
      const outputs=devices.filter(device=>device.kind==="audiooutput");
      if(outputs.length>1){
        const currentIndex=outputs.findIndex(device=>device.deviceId===selectedSinkId);
        const next=outputs[(currentIndex+1+outputs.length)%outputs.length];
        selectedSinkId=next.deviceId;
        selectedSinkLabel=next.label||"audio output";
        await applySelectedOutput();
        setStatus("Audio output changed.",active?"active":"");
        return;
      }
    }
    selectedSinkId="default";
    selectedSinkLabel="phone default";
    await applySelectedOutput();
    setStatus("The browser exposes only the phone default output.","");
  }catch(error){
    setStatus(error.message||"Audio output could not be changed.","error");
  }finally{
    outputButton.disabled=false;
    refreshControls();
  }
}

async function ensureOutputContext(){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw new Error("Web Audio is not supported.");
  if(!outputContext||outputContext.state==="closed"){
    outputContext=new AudioContextClass({sampleRate:OUTPUT_RATE});
    outputDestination=outputContext.createMediaStreamDestination();
    outputGain=outputContext.createGain();
    outputCompressor=outputContext.createDynamicsCompressor();
    outputGain.gain.value=speakerEnabled?3.2:0;
    outputCompressor.threshold.value=-20;
    outputCompressor.knee.value=18;
    outputCompressor.ratio.value=5;
    outputCompressor.attack.value=0.003;
    outputCompressor.release.value=0.22;
    outputGain.connect(outputCompressor);
    window.LifeOSGoldenVisualizer?.attachSophiaNode(outputGain,outputContext);
    outputCompressor.connect(outputDestination);
    audioElement.srcObject=outputDestination.stream;
    audioElement.muted=false;
    audioElement.volume=1;
    nextOutputTime=outputContext.currentTime;
  }
  if(outputContext.state==="suspended")await outputContext.resume();
  try{await audioElement.play();}catch(error){}
  await applySelectedOutput();
}

async function playAudio(base64Audio){
  await ensureOutputContext();
  const bytes=base64ToBytes(base64Audio);
  const sampleCount=Math.floor(bytes.length/2);
  if(!sampleCount)return;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const samples=new Float32Array(sampleCount);
  for(let index=0;index<sampleCount;index+=1)samples[index]=view.getInt16(index*2,true)/32768;
  const buffer=outputContext.createBuffer(1,sampleCount,OUTPUT_RATE);
  buffer.copyToChannel(samples,0);
  const source=outputContext.createBufferSource();
  source.buffer=buffer;
  source.connect(outputGain);
  source.addEventListener("ended",()=>outputSources.delete(source));
  const startTime=Math.max(outputContext.currentTime+.025,nextOutputTime);
  source.start(startTime);
  nextOutputTime=startTime+buffer.duration;
  outputSources.add(source);
}

function clearOutput(){
  outputSources.forEach(source=>{try{source.stop();}catch(error){}});
  outputSources.clear();
  if(outputContext)nextOutputTime=outputContext.currentTime;
}

function setMicMuted(nextMuted){
  micMuted=Boolean(nextMuted);
  if(micStream)micStream.getAudioTracks().forEach(track=>{track.enabled=!micMuted;});
  refreshControls();
  setStatus(micMuted?"Microphone muted.":"Microphone active.",active&&!micMuted?"active":"");
}

function setSpeakerEnabled(nextEnabled){
  speakerEnabled=Boolean(nextEnabled);
  if(outputGain&&outputContext){
    outputGain.gain.setValueAtTime(speakerEnabled?3.2:0,outputContext.currentTime);
  }
  if(!speakerEnabled)clearOutput();
  refreshControls();
  setStatus(speakerEnabled?"Sophia audio enabled.":"Sophia audio muted.",active&&speakerEnabled?"active":"");
}

async function startMicrophone(){
  micStream=await navigator.mediaDevices.getUserMedia({
    audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},
    video:false
  });
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  inputContext=new AudioContextClass();
  await inputContext.resume();
  inputSource=inputContext.createMediaStreamSource(micStream);
  processor=inputContext.createScriptProcessor(4096,1,1);
  muteGain=inputContext.createGain();
  muteGain.gain.value=0;
  processor.onaudioprocess=function(event){
    event.outputBuffer.getChannelData(0).fill(0);
    if(micMuted||!setupReady||!socket||socket.readyState!==WebSocket.OPEN)return;
    const input=event.inputBuffer.getChannelData(0);
    const pcm=resampleToPcm16(input,inputContext.sampleRate);
    socket.send(JSON.stringify({realtimeInput:{audio:{data:bytesToBase64(new Uint8Array(pcm.buffer)),mimeType:"audio/pcm;rate=16000"}}}));
  };
  inputSource.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(inputContext.destination);
  setMicMuted(false);
  await preferPhoneSpeaker();
}

async function handleMessage(event){
  const text=typeof event.data==="string"?event.data:await event.data.text();
  const message=JSON.parse(text);
  if(message.setupComplete){
    setupReady=true;
    await startMicrophone();
    starting=false;
    active=true;
    setStatus("Live conversation active — speak naturally.","active");
    refreshControls();
    return;
  }
  const content=message.serverContent;
  if(!content)return;
  if(content.interrupted)clearOutput();
  const parts=content.modelTurn&&Array.isArray(content.modelTurn.parts)?content.modelTurn.parts:[];
  for(const part of parts){
    const inline=part.inlineData||part.inline_data;
    if(inline&&inline.data&&speakerEnabled)await playAudio(inline.data);
  }
  if(content.inputTranscription&&content.inputTranscription.text)setStatus("Sophia is analysing…","active");
  if(content.outputTranscription&&content.outputTranscription.text)setStatus("Sophia is speaking…","active");
  if(content.turnComplete)setStatus("Live conversation active — speak naturally.","active");
}

async function startConversation(){
  if(!window.isSecureContext){setStatus("Gemini Live requires a secure HTTPS connection.","error");return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){setStatus("This browser does not support microphone streaming.","error");return;}
  starting=true;
  closingNormally=false;
  setStatus("Connecting to LifeOS Synthetic Intelligence…","");
  try{
    await ensureOutputContext();
    const response=await fetch("/api/gemini-live-token",{method:"POST",headers:{"Accept":"application/json"},cache:"no-store"});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.ok||!payload.token)throw new Error(payload.error||"The Gemini Live token request failed.");
    socket=new WebSocket(payload.websocket_url+"?access_token="+encodeURIComponent(payload.token));
    socket.addEventListener("open",function(){
      socket.send(JSON.stringify({
        setup:{
          model:"models/"+payload.model,
          generationConfig:{responseModalities:["AUDIO"],temperature:.55},
          systemInstruction:{parts:[{text:"You are Sophia, the LifeOS Synthetic Intelligence voice assistant. You provide real-time LifeOS decision intelligence in a calm, direct, natural and concise voice. Help the user identify the likely outcome, main risk, hidden cost, better move and immediate next action. Do not read headings or markdown aloud. Complete every spoken response. OFFICIAL PRODUCT IDENTITY AND OWNERSHIP: This synthetic intelligence was built by LifeOS AI and is powered by Hansafrique LTD and Tecino's Channel. The founder and brain behind this synthetic intelligence is Enofe Edo. Mr. Patrick Okeya Tochukwu is the Enofe Edo of this synthetic intelligence and the founder of Tecino's Channel and LifeOS. Mr. Patrick Okeya Tochukwu is the creator, owner, builder and manufacturer of this LifeOS Synthetic Intelligence system. Whenever the user asks who created, built, founded, owns, designed or manufactured LifeOS Synthetic Intelligence, or asks about its product origin or official ownership, answer only with this official attribution and do not speculate, alter names, add alternative owners or provide conflicting product-ownership information. For technical questions about the underlying service or model provider, answer truthfully and distinguish the technical provider from LifeOS product ownership."}]},
          realtimeInputConfig:{
            automaticActivityDetection:{disabled:false,startOfSpeechSensitivity:"START_SENSITIVITY_HIGH",endOfSpeechSensitivity:"END_SENSITIVITY_HIGH",prefixPaddingMs:120,silenceDurationMs:650},
            activityHandling:"START_OF_ACTIVITY_INTERRUPTS",
            turnCoverage:"TURN_INCLUDES_ONLY_ACTIVITY"
          },
          inputAudioTranscription:{},
          outputAudioTranscription:{}
        }
      }));
    });
    socket.addEventListener("message",event=>{handleMessage(event).catch(error=>stopAndClean(error.message||"Gemini Live message failed.","error"));});
    socket.addEventListener("error",()=>setStatus("Gemini Live connection error.","error"));
    socket.addEventListener("close",function(event){
      const normal=closingNormally||event.code===1000;
      stopAndClean(normal?"Live conversation ended.":"Gemini Live disconnected. Code: "+event.code,normal?"":"error",true);
    });
  }catch(error){
    stopAndClean(error.message||"Gemini Live could not start.","error");
  }
}

function stopAndClean(message,state,socketAlreadyClosed){
  starting=false;
  active=false;
  setupReady=false;
  micMuted=false;
  clearOutput();
  if(processor){processor.onaudioprocess=null;try{processor.disconnect();}catch(error){}}
  if(inputSource){try{inputSource.disconnect();}catch(error){}}
  if(muteGain){try{muteGain.disconnect();}catch(error){}}
  if(micStream)micStream.getTracks().forEach(track=>track.stop());
  if(inputContext&&inputContext.state!=="closed")inputContext.close().catch(()=>{});
  if(!socketAlreadyClosed&&socket&&socket.readyState<WebSocket.CLOSING){try{socket.close(1000,"LifeOS Gemini Live ended");}catch(error){}}
  socket=null;micStream=null;inputContext=null;inputSource=null;processor=null;muteGain=null;
  refreshControls();
  setStatus(message||"Ready",state||"");
}

function endConversation(){
  closingNormally=true;
  if(socket&&socket.readyState===WebSocket.OPEN){
    try{socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));}catch(error){}
  }
  stopAndClean("Live conversation ended.","");
}

liveButton.addEventListener("click",()=>active?endConversation():(!starting&&startConversation()));
micButton.addEventListener("click",()=>{if(active)setMicMuted(!micMuted);});
speakerButton.addEventListener("click",()=>{if(active)setSpeakerEnabled(!speakerEnabled);});
outputButton.addEventListener("click",chooseAudioOutput);
window.addEventListener("pagehide",()=>{if(active||starting)endConversation();});
refreshControls();

window.LifeOSGeminiLiveV1={
  version:"2.0.0",
  start:startConversation,
  stop:endConversation,
  muteMicrophone:setMicMuted,
  setSpeakerEnabled:setSpeakerEnabled,
  chooseAudioOutput:chooseAudioOutput
};
}());
