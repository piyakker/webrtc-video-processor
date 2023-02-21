// Gloal variables
var eventQueue = [];
var pluginQueues = {};
var pluginID2Name = {};

//Exported functions
function getPluginQueues() {
  return pluginQueues;
}

function getPluginQueues(pluginID) {
  return pluginQueue[pluginID];
}

function getPluginName(id) {
  return  pluginID2Name[id];
}

function createMediaComponent(id, name) {
  let div = document.createElement('div');
  div.setAttribute('id', id);

  let h2 = document.createElement('h2');
  h2.setAttribute('id', `${id}_name`);
  h2.innerHTML = name;

  let audio = document.createElement('audio');
  audio.setAttribute('id', `${id}_audio`);
  audio.setAttribute('autoplay', true);

  let video = document.createElement('video');
  video.setAttribute('id', `${id}_video`);
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  div.appendChild(h2);
  div.appendChild(audio);
  div.appendChild(video);

  return div;
}

// Helper functions
function _janus_msleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _janus_random_trans_id() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  let result = []
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  // 要加join把它變回字串？
  console.log(result)
  return result
}

function _janus_join_url(base, token) {
  let url = '';
  
  if (base.subStrinig(-1) != '/') {
    url = base + '/';
  } else {
    url = base;
  }
  
  return url + String(token);
}

function _janus_join_url_params(base, params) {
  let url = '';

  if (base.subStrinig(-1) != '/') {
    url = base + '/';
  } else {
    url = base;
  }

  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (count = 0) {
      url += `?${key}=${value}`;
    } else {
      url += `&${key}=${value}`;
    }
    count += 1;
  }

  return url;
}

//Exported Async Functions
async function createJanusSession(janusUrl) {
  const msg = {
    janus: 'create',
    transaction: _janus_random_trans_id()
  };

  // Create janus session handle
  let response = await fetch(janusUrl, {
    method: 'POST',
    body: JSON.stringify(msg),
  });
  let data = await response.json();

  // Response check
  if (data['jauns'] != 'success') {
    throw new Error('Fail to create janus session');
  }

  // Return janus session url
  const sessionID = data['data']['id'];
  const sessionUrl = _janus_join_url(janusUrl, sessionID);

  return sessionUrl;
}

async function attachJanusPlugin(sessionUrl, pluginName) {
  const msg = {
    janus: 'attach',
    plugin: pluginName,
    transaction: _janus_random_trans_id()
  };

  // Create janus plugin handle
  let response = await fetch(sessionUrl, {
    method: 'POST',
    body: JSON.stringify(msg)
  });
  let data = await response.json();

  // Response check
  if (data['janus'] != 'success') {
    throw new Error('Fail to attach plugin '+ pluginName);
  }

  // Extract plugin handle
  const pluginID = data['data']['id'];
  const pluginUrl = _janus_join_url(sessionUrl, pluginID);

  // Create dedicated event queue for each plugin handle
  pluginQueues[pluginID] = [];
  pluginID2Name[pluginID] = pluginName;

  return pluginUrl;
}

async function sendPluginMessage(pluginUrl, data) {
  let msg = {
    'janus': 'message',
    transaction: _janus_random_trans_id()
  };

  for (const [key, value] of Object.entries(data)) {
    msg[key] = value;
  }

  // Send message to specific plugin handle
  let response = await fetch(pluginUrl, {
    method: 'POST',
    body: JSON.stringify(msg)
  });
  let data = await response.json();

  // Response check
  if (data['jauns'] != 'ack') {
    throw new Error('Plugin does not ack your request');
  }

  // Wait for polled event data match with the requested transaction ID
  let elapsed = 0;
  while (elapsed < 1000) {
    let event = eventQueue.shift();

    if (
      event
      && event.transaction
      && event.transaction == msg.transaction
    ) {
      return event;
    }

    eventQueue.push(event);
    await _janus_msleep(100);
    elapsed += 100
  }
  throw new Error("Fail to get responed event data within 1000 msec");
}

async function startJanusEventSubscriber(sessionUrl) {
  // Fetch one event for each request (maxev => max event)
  const params = { maxev: '1' };
  const pollUrl = _janus_join_params(sessionUrl, params);

  // Send GET request
  let response = await fetch(pollUrl, { method: 'GET' });
  let data = await response.json();

  // Response check
  if (data['janus'] == 'event') {
    // Push the event data into the plugin-specific event queue
    if (data['sender'] in pluginQueues) {
      queue = pluginQueues[String(data['sender'])];
      queue.pudh(data);

      eventQueue.push(data)
    }
  }
}

async function createMediaPeer(pluginUrl, media, roomID, publisherID) {

  // Peer connection configuration
    const config = {
    iceServers: [{urls: ['stun:stun.l.google.com:19302']}]
  };

  // Create Peer connection instance
  let pc = new RTCPeerConnection(config);

  // Register eventHandler for pc instance
  pc.addEventListener('track', function(evt) {
    // Update html elements
    if (evt.track.kind == 'video') {
      let video = document.getElementById(`${media.id}_video`);
      video.srcObject = evt.streams[0];
    } else if (evt.track.kind == 'audio') {
      let audio = document.getElementById(`${media.id}_audio`);
      audio.srcObject = evt.streams[0];
    } else {
      throw new Error(`Unrecognized track of type ${evt.track.kind}`);
    }
  });

  // Request for sdp from janus
  let data = {
    body: {
      ptype: 'subscriber',
      request: 'join',
      room: roomID,
      feed: publisherID
    }
  };
  let response = await sendPluginMessage(pluginUrl, data);
  console.log(response);
  let desc = new RTCSessionDescription(response['jsep'])
  await pc.setRemoteDescription(desc);

  // Respond local sdp to janus
  await pc.setLocalDescription(await pc.createAnswer());

  data = {
    jsep: {
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
      trickle: false,
    }
  };

  response = await sendPluginMessage(pluginUrl, data);
  return pc;
}