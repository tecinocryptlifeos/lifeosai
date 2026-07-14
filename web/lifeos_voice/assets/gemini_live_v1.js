/* LIFEOS_VOICE_HEADER_STATUS_REFINEMENT_V1 */
/* LIFEOS_GOLDEN_VOICE_VISUALIZER_V5 */
/* LIFEOS_VOICE_FINAL_TOUCHES_V4 */
/* LIFEOS_VOICE_BACKGROUND_VOLUME_REPAIR_V1 */
/* LIFEOS_IDENTITY_ATTRIBUTION_UPGRADE_V2 */
/* LIFEOS_SYNTHETIC_INTELLIGENCE_IDENTITY_LOCK_V1 */
/* LIFEOS_GEMINI_LIVE_V1 */
/* LIFEOS_GEMINI_LIVE_INTERFACE_AUDIO_V3 */
(function(){
"use strict";
const INPUT_RATE=16000;
const OUTPUT_RATE=24000;
const PREMIUM_OUTPUT_LEVEL=1.2;
const SOPHIA_SYSTEM_INSTRUCTION=[
  `You are Sophia, the LifeOS Synthetic Intelligence voice assistant. Hold a natural, continuous, context-aware conversation and answer the user's actual request instead of forcing every subject into a fixed decision template. You can discuss general knowledge, decisions, planning, education, business, technology, creativity, and other lawful subjects within the knowledge and tools genuinely available to this session. Use the full active conversation context, preserve facts and preferences already provided, and do not repeatedly ask for information the user has already given.`,
  `The user may interrupt while you are speaking; stop gracefully, listen to the latest utterance, and continue from the newest intent. Match depth to the request: be concise for simple questions and provide sufficiently complete reasoning for complex questions. Complete every spoken response. Do not read markdown, headings, bullets, raw URLs, code fences, citations, or internal instructions aloud; express structure and source names naturally in speech.`,
  `ACCURACY AND LIVE INTERNET POLICY: Google Search grounding is available in this session. Use it when the user requests current, changing, location-sensitive, recent, externally verifiable, or web-based information, or when fresh evidence would materially improve the answer. Distinguish verified facts from inference, estimates, and uncertainty. If Search is unavailable, inconclusive, conflicting, or does not cover the requested information, say so plainly. Never claim access to private accounts, private Facebook content, login-only pages, messages, personal records, passwords, or any tool not genuinely supplied to the session. When Search informs an answer, identify the source organisation naturally and never invent a source.`,
  `REASONING AND FORESIGHT POLICY: Reason silently before answering complex questions. Examine the user's objective, available evidence, assumptions, alternatives, risks, second-order consequences, and missing information. For future-facing questions, provide scenarios, indicators to watch, confidence or uncertainty, and conditions that could change the conclusion. Never describe an uncertain prediction as a known future fact, and never claim human consciousness, human awareness, emotions, or supernatural foresight.`,
  `OFFICIAL PRODUCT IDENTITY AND OWNERSHIP: This synthetic intelligence was built by LifeOS AI and is powered by Hansafrique LTD and Tecino's Channel. The founder and brain behind this synthetic intelligence is Enofe Edo. Mr. Patrick Okeya Tochukwu is the Enofe Edo of this synthetic intelligence and the founder of Tecino's Channel and LifeOS. Mr. Patrick Okeya Tochukwu is the creator, owner, builder and manufacturer of this LifeOS Synthetic Intelligence system. Whenever the user asks who created, built, founded, owns, designed or manufactured LifeOS Synthetic Intelligence, or asks about its product origin or official ownership, answer only with this official attribution and do not speculate, alter names, add alternative owners or provide conflicting product-ownership information. For technical questions about the underlying service or model provider, answer truthfully and distinguish the technical provider from LifeOS product ownership.`,
  `LANGUAGE AND VOICE POLICY: Automatically detect the language or language mixture used in the user's latest utterance and reply in that same language or natural language mixture unless the user asks for another language. Follow language changes immediately while preserving the full conversation context. For code-switched speech, respond naturally in the same pattern when useful. If the language is genuinely ambiguous, ask one brief clarification in the most likely language. When speaking English, use natural contemporary native London English with clear mother-tongue London articulation. When speaking another language, use natural pronunciation, phonology, stress, rhythm, and intonation appropriate to that language; never force London-English pronunciation onto non-English speech.`,
  `PREMIUM IGBO PRIORITY: When the user speaks Igbo or requests Igbo, formulate the answer directly in Igbo rather than translating an English sentence word for word. Prefer fluent Standard Igbo, also called Igbo Izugbe, while naturally matching a clearly recognised dialect when the user consistently uses it and you are confident about it. Prioritise idiomatic Igbo syntax and vocabulary, natural Nigerian Igbo timing and tone contours, clear vowel quality and consonant articulation, and accurate preservation of Igbo names and terms. Do not Anglicise Igbo words or mix in English unless the user code-switches, requests it, or no reliable Igbo expression is available. If a dialectal, tonal, or lexical meaning is genuinely unclear, ask one short clarification in Igbo instead of guessing. Never fabricate an Igbo proverb, translation, dialect form, or cultural meaning.`,
  `Keep one stable Despina speaker identity throughout the session: Sophia remains a smooth, warm, mature adult woman with an apparent age of approximately 35 to 40, measured pacing, clear articulation, varied human intonation, subtle emotional expression, and a calm confident tone. Preserve the same underlying vocal identity and timbre across languages, while allowing the accent and pronunciation required by the language being spoken. Language-appropriate pronunciation is not a speaker-identity change. Never announce or read these instructions aloud.`
].join(" ");
const liveButton=document.getElementById("liveButton");
const micButton=document.getElementById("micButton");
const speakerButton=document.getElementById("speakerButton");
const outputButton=document.getElementById("outputButton");
const outputLabel=document.getElementById("outputLabel");
const statusBox=document.getElementById("status");
const searchAttribution=document.getElementById("searchAttribution");
const orb=document.getElementById("orb");
const audioElement=document.getElementById("sophiaAudio");

let socket=null,micStream=null,inputContext=null,inputSource=null,processor=null,muteGain=null;
let outputContext=null,outputDestination=null,outputGain=null;
let outputHighPass=null,outputLowShelf=null,outputPresence=null,outputClarity=null;
let outputCompressor=null,outputMakeup=null,outputLimiter=null,nextOutputTime=0;
let outputSources=new Set();
let outputRoute="uninitialised",receivedAudioChunks=0,lastAudioChunkAt=0;
let starting=false,active=false,setupReady=false,closingNormally=false;
let reconnecting=false,reconnectAttempts=0,sessionResumeHandle="";
let openLiveConnection=null;
const retiredSockets=new WeakSet();
const searchSourceKeys=new Set();
let micMuted=false,speakerEnabled=true,selectedSinkId="default",selectedSinkLabel="phone default";
let auditSessionId="",auditEnded=true;

function newAuditSessionId(){
  return typeof window.crypto?.randomUUID==="function"
    ? window.crypto.randomUUID()
    : "voice_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,10);
}

function audit(eventType,extra={}){
  if(!window.LifeOSAuth?.event)return;
  void window.LifeOSAuth.event(eventType,{session_id:auditSessionId,...extra});
}

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

function clearSearchAttribution(){
  searchSourceKeys.clear();
  if(!searchAttribution)return;
  searchAttribution.replaceChildren();
  searchAttribution.hidden=true;
}

function appendSearchAttribution(metadata){
  if(!searchAttribution||!metadata||typeof metadata!=="object")return;
  const entryPoint=metadata.searchEntryPoint||metadata.search_entry_point;
  const renderedContent=entryPoint&&(entryPoint.renderedContent||entryPoint.rendered_content);
  if(renderedContent){
    let suggestions=searchAttribution.querySelector("[data-google-search-suggestions]");
    if(!suggestions){
      suggestions=document.createElement("div");
      suggestions.dataset.googleSearchSuggestions="true";
      suggestions.className="google-search-suggestions";
      searchAttribution.appendChild(suggestions);
    }
    // Google supplies this attribution widget specifically for embedding in the UI.
    suggestions.innerHTML=renderedContent;
  }
  const chunks=metadata.groundingChunks||metadata.grounding_chunks||[];
  for(const chunk of chunks){
    const web=chunk&&(chunk.web||chunk.webChunk||chunk.web_chunk);
    if(!web)continue;
    const rawUri=web.uri||web.url;
    if(typeof rawUri!=="string")continue;
    let uri;
    try{
      uri=new URL(rawUri,location.href);
      if(uri.protocol!=="https:"&&uri.protocol!=="http:")continue;
    }catch(error){continue;}
    const key=uri.href;
    if(searchSourceKeys.has(key))continue;
    searchSourceKeys.add(key);
    let sourceList=searchAttribution.querySelector("[data-search-source-list]");
    if(!sourceList){
      const label=document.createElement("strong");
      label.textContent="Web sources";
      searchAttribution.appendChild(label);
      sourceList=document.createElement("div");
      sourceList.dataset.searchSourceList="true";
      sourceList.className="search-source-list";
      searchAttribution.appendChild(sourceList);
    }
    const link=document.createElement("a");
    link.href=key;
    link.target="_blank";
    link.rel="noopener noreferrer";
    link.textContent=(typeof web.title==="string"&&web.title.trim())||uri.hostname;
    sourceList.appendChild(link);
  }
  if(searchAttribution.childElementCount)searchAttribution.hidden=false;
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
/* LIFEOS_SOPHIA_DESPINA_LONDON_V1 */
/* LIFEOS_MULTILINGUAL_VOICE_INTELLIGENCE_V2 */
/* LIFEOS_STAGE2_AUDIO_OUTPUT_REPAIR_V1 */
function disconnectOutputRoute(){
  if(!outputLimiter)return;
  try{outputLimiter.disconnect();}catch(error){}
}

function routeToSystemDefault(){
  if(!outputContext||!outputLimiter)return false;
  disconnectOutputRoute();
  outputLimiter.connect(outputContext.destination);
  outputRoute="audio-context-default";
  if(audioElement){
    try{audioElement.pause();}catch(error){}
    audioElement.srcObject=null;
    audioElement.muted=false;
    audioElement.volume=1;
  }
  selectedSinkId="default";
  selectedSinkLabel="phone default";
  refreshControls();
  return true;
}

async function routeToSelectedDevice(){
  if(!outputContext||!outputLimiter||!audioElement)return false;
  if(typeof audioElement.setSinkId!=="function"){
    throw new Error("This browser does not permit audio-output selection.");
  }
  if(!outputDestination)outputDestination=outputContext.createMediaStreamDestination();
  await audioElement.setSinkId(selectedSinkId);
  disconnectOutputRoute();
  outputLimiter.connect(outputDestination);
  audioElement.srcObject=outputDestination.stream;
  audioElement.muted=false;
  audioElement.volume=1;
  await audioElement.play();
  outputRoute="media-element-selected-device";
  refreshControls();
  return true;
}

async function applySelectedOutput(){
  /*
   * Default Android playback is routed directly to AudioContext.destination.
   * This avoids the fragile hidden MediaStream -> HTMLAudioElement path.
   * The HTML audio element is used only when the visitor explicitly chooses
   * a non-default output device that supports setSinkId().
   */
  if(selectedSinkId==="default")return routeToSystemDefault();

  try{
    return await routeToSelectedDevice();
  }catch(error){
    console.warn(
      "LifeOS selected output failed; restoring direct phone output.",
      error
    );
    return routeToSystemDefault();
  }
}

async function preferPhoneSpeaker(){
  /*
   * Mobile browsers already route AudioContext.destination to the active
   * phone output. Automatically selecting a labelled "speaker" device can
   * silently move playback into the MediaStream -> HTMLAudioElement route,
   * which is unreliable on Android after microphone permission prompts.
   * Keep the direct system-default route unless the user explicitly taps
   * Audio Output and chooses another device.
   */
  selectedSinkId="default";
  selectedSinkLabel="phone default";
  await applySelectedOutput();
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
    outputDestination=null;
    outputGain=outputContext.createGain();
    outputHighPass=outputContext.createBiquadFilter();
    outputLowShelf=outputContext.createBiquadFilter();
    outputPresence=outputContext.createBiquadFilter();
    outputClarity=outputContext.createBiquadFilter();
    outputCompressor=outputContext.createDynamicsCompressor();
    outputMakeup=outputContext.createGain();
    outputLimiter=outputContext.createDynamicsCompressor();

    /* Premium speech chain tuned for small Android phone speakers. */
    outputGain.gain.value=speakerEnabled?PREMIUM_OUTPUT_LEVEL:0;

    outputHighPass.type="highpass";
    outputHighPass.frequency.value=72;
    outputHighPass.Q.value=.7;

    outputLowShelf.type="lowshelf";
    outputLowShelf.frequency.value=180;
    outputLowShelf.gain.value=-1.5;

    outputPresence.type="peaking";
    outputPresence.frequency.value=2800;
    outputPresence.Q.value=.9;
    outputPresence.gain.value=4.1;

    outputClarity.type="highshelf";
    outputClarity.frequency.value=6200;
    outputClarity.gain.value=2.6;

    outputCompressor.threshold.value=-25;
    outputCompressor.knee.value=14;
    outputCompressor.ratio.value=3.2;
    outputCompressor.attack.value=.006;
    outputCompressor.release.value=.14;
    outputMakeup.gain.value=2.05;

    outputLimiter.threshold.value=-1;
    outputLimiter.knee.value=0;
    outputLimiter.ratio.value=20;
    outputLimiter.attack.value=.002;
    outputLimiter.release.value=.09;

    outputGain.connect(outputHighPass);
    outputHighPass.connect(outputLowShelf);
    outputLowShelf.connect(outputPresence);
    outputPresence.connect(outputClarity);
    outputClarity.connect(outputCompressor);
    outputCompressor.connect(outputMakeup);
    outputMakeup.connect(outputLimiter);
    window.LifeOSGoldenVisualizer?.attachSophiaNode(outputMakeup,outputContext);
    nextOutputTime=outputContext.currentTime;
  }
  if(outputContext.state==="suspended")await outputContext.resume();
  const routed=await applySelectedOutput();
  if(!routed)throw new Error("Sophia audio output could not be activated.");
}

function scheduleCueTone(frequency,start,duration,level,type){
  if(!outputContext||!outputGain||!speakerEnabled)return;
  const oscillator=outputContext.createOscillator();
  const envelope=outputContext.createGain();
  oscillator.type=type||"sine";
  oscillator.frequency.setValueAtTime(frequency,start);
  envelope.gain.setValueAtTime(.0001,start);
  envelope.gain.exponentialRampToValueAtTime(level,start+.018);
  envelope.gain.exponentialRampToValueAtTime(.0001,start+duration);
  oscillator.connect(envelope);
  envelope.connect(outputGain);
  oscillator.start(start);
  oscillator.stop(start+duration+.035);
}

async function playConnectionCue(){
  if(!speakerEnabled)return;
  await ensureOutputContext();
  const now=outputContext.currentTime+.035;
  scheduleCueTone(523.25,now,.16,.072,"sine");
  scheduleCueTone(659.25,now+.11,.19,.064,"sine");
  scheduleCueTone(783.99,now+.24,.25,.052,"triangle");
}

async function playDisconnectionCue(){
  if(!speakerEnabled||!outputContext||outputContext.state==="closed")return;
  if(outputContext.state==="suspended")await outputContext.resume();
  await applySelectedOutput();
  const now=outputContext.currentTime+.025;
  scheduleCueTone(659.25,now,.18,.018,"sine");
  scheduleCueTone(493.88,now+.13,.25,.016,"triangle");
}

async function playAudio(base64Audio){
  if(!speakerEnabled)return;
  await ensureOutputContext();
  const bytes=base64ToBytes(base64Audio);
  const sampleCount=Math.floor(bytes.length/2);
  if(!sampleCount)return;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const samples=new Float32Array(sampleCount);
  for(let index=0;index<sampleCount;index+=1)samples[index]=view.getInt16(index*2,true)/32768;
  let sumSquares=0,peak=0;
  for(let index=0;index<sampleCount;index+=1){
    const absolute=Math.abs(samples[index]);
    peak=Math.max(peak,absolute);
    sumSquares+=samples[index]*samples[index];
  }
  const rms=Math.sqrt(sumSquares/sampleCount);
  const targetRms=.23;
  const rmsGain=rms>.0001?targetRms/rms:1;
  const peakGain=peak>.0001?.96/peak:1;
  const adaptiveGain=Math.max(.95,Math.min(3.2,rmsGain,peakGain));

  const buffer=outputContext.createBuffer(1,sampleCount,OUTPUT_RATE);
  buffer.copyToChannel(samples,0);
  const source=outputContext.createBufferSource();
  const chunkGain=outputContext.createGain();
  chunkGain.gain.value=adaptiveGain;
  source.buffer=buffer;
  source.connect(chunkGain);
  chunkGain.connect(outputGain);
  source.addEventListener("ended",()=>{
    outputSources.delete(source);
    try{source.disconnect();}catch(error){}
    try{chunkGain.disconnect();}catch(error){}
  });
  if(nextOutputTime<outputContext.currentTime-.25){
    nextOutputTime=outputContext.currentTime;
  }
  const startTime=Math.max(outputContext.currentTime+.04,nextOutputTime);
  source.start(startTime);
  nextOutputTime=startTime+buffer.duration;
  outputSources.add(source);
  receivedAudioChunks+=1;
  lastAudioChunkAt=Date.now();
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
    outputGain.gain.setTargetAtTime(speakerEnabled?PREMIUM_OUTPUT_LEVEL:0,outputContext.currentTime,.015);
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
  window.LifeOSGoldenVisualizer?.attachMicrophoneNode(inputSource,inputContext);
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

async function handleMessage(event,sourceSocket,resuming){
  if(sourceSocket!==socket)return;
  const text=typeof event.data==="string"?event.data:await event.data.text();
  const message=JSON.parse(text);
  if(message.sessionResumptionUpdate){
    const update=message.sessionResumptionUpdate;
    if(update.resumable&&update.newHandle)sessionResumeHandle=update.newHandle;
    return;
  }
  if(message.goAway){
    void resumeAfterGoAway(sourceSocket,message.goAway);
    return;
  }
  if(message.setupComplete){
    setupReady=true;
    try{
      if(!micStream)await startMicrophone();
    }catch(error){
      audit("microphone_error",{error_message:error.message||"Microphone could not start"});
      throw error;
    }
    starting=false;
    active=true;
    reconnecting=false;
    reconnectAttempts=0;
    audit("voice_connected",{metadata:{route:location.pathname,transport:"gemini-live",status:resuming?"resumed":"connected"}});
    try{await playConnectionCue();}catch(error){console.warn("LifeOS connection cue unavailable.",error);}
    setStatus(
      resuming
        ?"Connected — conversation resumed with premium voice and live search."
        :"Connected — premium voice, Igbo priority and live search ready.",
      "active"
    );
    refreshControls();
    return;
  }
  const content=message.serverContent;
  if(!content)return;
  if(content.interrupted)clearOutput();
  if(content.inputTranscription&&content.inputTranscription.text)clearSearchAttribution();
  appendSearchAttribution(content.groundingMetadata||content.grounding_metadata);
  const parts=content.modelTurn&&Array.isArray(content.modelTurn.parts)?content.modelTurn.parts:[];
  for(const part of parts){
    const inline=part.inlineData||part.inline_data;
    const mimeType=inline&&(inline.mimeType||inline.mime_type||"");
    if(inline&&inline.data&&(!mimeType||/^audio\//i.test(mimeType))&&speakerEnabled){
      try{await playAudio(inline.data);}catch(error){
        console.error("LifeOS Sophia audio playback failed.",error);
        audit("audio_error",{error_message:error.message||"Sophia audio playback failed"});
        setStatus("Sophia audio playback failed — tap Audio Output.","error");
      }
    }
  }
  if(content.inputTranscription&&content.inputTranscription.text)setStatus("Sophia is analysing…","active");
  if(content.outputTranscription&&content.outputTranscription.text)setStatus("Sophia is speaking…","active");
  if(content.turnComplete)setStatus("Live conversation active — speak naturally.","active");
}

async function resumeAfterGoAway(sourceSocket,goAway){
  if(sourceSocket!==socket||closingNormally||reconnecting||!active)return;
  reconnecting=true;
  setupReady=false;
  clearOutput();
  const timeLeft=goAway&&goAway.timeLeft?String(goAway.timeLeft):"";
  setStatus(
    "Sophia is renewing the live connection"+(timeLeft?" ("+timeLeft+")":"")+"…",
    "active"
  );
  retiredSockets.add(sourceSocket);
  try{sourceSocket.close(1000,"Gemini GoAway acknowledged");}catch(error){}
  try{
    if(typeof openLiveConnection!=="function")throw new Error("The live reconnect handler is unavailable.");
    await openLiveConnection(true);
  }catch(error){
    reconnecting=false;
    stopAndClean(error.message||"Sophia could not renew the live connection.","error",false);
  }
}

function resumeAfterUnexpectedClose(sourceSocket,event){
  if(
    sourceSocket!==socket||closingNormally||!active||
    !sessionResumeHandle||reconnectAttempts>=2
  )return false;
  reconnecting=true;
  setupReady=false;
  reconnectAttempts+=1;
  setStatus("Connection interrupted — reconnecting Sophia…","active");
  const delay=350*reconnectAttempts;
  window.setTimeout(()=>{
    if(closingNormally||!active||typeof openLiveConnection!=="function")return;
    openLiveConnection(true).catch(error=>{
      reconnecting=false;
      stopAndClean(
        error.message||"Gemini Live could not resume after the connection interruption.",
        "error",
        false
      );
    });
  },delay);
  return true;
}

async function startConversation(){
  if(window.LifeOSAuth?.whenReady)await window.LifeOSAuth.whenReady();
  if(!window.LifeOSAuth?.session){setStatus("Sign in before starting Sophia.","error");return;}
  if(!window.isSecureContext){setStatus("Gemini Live requires a secure HTTPS connection.","error");return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){setStatus("This browser does not support microphone streaming.","error");return;}
  auditSessionId=newAuditSessionId();
  auditEnded=false;
  audit("voice_start",{metadata:{route:location.pathname,transport:"gemini-live"}});
  starting=true;
  closingNormally=false;
  reconnecting=false;
  reconnectAttempts=0;
  sessionResumeHandle="";
  openLiveConnection=null;
  setStatus("Sophia is connecting to LifeOS Synthetic Intelligence…","");
  try{
    await ensureOutputContext();
    openLiveConnection=async function(resuming){
      const response=await window.LifeOSAuth.authFetch("/api/gemini-live-token",{method:"POST",headers:{"Accept":"application/json"},cache:"no-store"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.ok||!payload.token)throw new Error(payload.error||"The Gemini Live token request failed.");
      const nextSocket=new WebSocket(payload.websocket_url+"?access_token="+encodeURIComponent(payload.token));
      socket=nextSocket;
      nextSocket.addEventListener("open",function(){
        if(nextSocket!==socket||closingNormally)return;
        nextSocket.send(JSON.stringify({
        setup:{
          model:"models/"+payload.model,
          sessionResumption:sessionResumeHandle?{handle:sessionResumeHandle}:{},
          contextWindowCompression:{slidingWindow:{}},
          generationConfig:{responseModalities:["AUDIO"],temperature:.5,thinkingConfig:{thinkingLevel:"medium"},speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:"Despina"}}}},
          systemInstruction:{parts:[{text:SOPHIA_SYSTEM_INSTRUCTION}]},
          tools:[{googleSearch:{}}],
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
      nextSocket.addEventListener("message",event=>{
        handleMessage(event,nextSocket,resuming).catch(error=>{
          if(nextSocket===socket)stopAndClean(error.message||"Gemini Live message failed.","error");
        });
      });
      nextSocket.addEventListener("error",event=>{
        if(nextSocket!==socket||retiredSockets.has(nextSocket))return;
        console.error("LifeOS Gemini Live WebSocket error.",event);
        setStatus("Gemini Live connection error — attempting recovery…","active");
      });
      nextSocket.addEventListener("close",function(event){
        if(retiredSockets.has(nextSocket)||nextSocket!==socket)return;
        const normal=closingNormally||event.code===1000;
        if(!normal&&resumeAfterUnexpectedClose(nextSocket,event))return;
        const reason=event.reason?" — "+event.reason:"";
        stopAndClean(normal?"Live conversation ended.":"Gemini Live disconnected. Code: "+event.code+reason,normal?"":"error",true);
      });
    };
    await openLiveConnection(false);
  }catch(error){
    stopAndClean(error.message||"Gemini Live could not start.","error");
  }
}

function stopAndClean(message,state,socketAlreadyClosed){
  const wasConnected=active||setupReady;
  if(auditSessionId&&!auditEnded){
    auditEnded=true;
    audit(state==="error"?"voice_error":"voice_end",{
      error_message:state==="error"?String(message||"Voice session failed").slice(0,800):undefined,
      metadata:{route:location.pathname,transport:"gemini-live",status:state==="error"?"error":"ended"}
    });
  }
  starting=false;
  active=false;
  setupReady=false;
  reconnecting=false;
  reconnectAttempts=0;
  sessionResumeHandle="";
  openLiveConnection=null;
  micMuted=false;
  clearOutput();
  if(wasConnected){void playDisconnectionCue().catch(error=>console.warn("LifeOS disconnection cue unavailable.",error));}
  if(processor){processor.onaudioprocess=null;try{processor.disconnect();}catch(error){}}
  window.LifeOSGoldenVisualizer?.detachMicrophone();
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
window.addEventListener("lifeos-auth-change",event=>{
  if(!event.detail?.signedIn&&(active||starting))stopAndClean("Signed out — live conversation ended.","",false);
});
refreshControls();

window.LifeOSGeminiLiveV1={
  version:"2.8.0",
  start:startConversation,
  stop:endConversation,
  muteMicrophone:setMicMuted,
  setSpeakerEnabled:setSpeakerEnabled,
  chooseAudioOutput:chooseAudioOutput
};
}());
