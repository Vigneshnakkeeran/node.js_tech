
const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
const showChat = document.querySelector("#showChat");
const backBtn = document.querySelector(".header__back");

myVideo.muted = true;

backBtn.addEventListener("click", () => {
  document.querySelector(".main__left").style.display = "flex";
  document.querySelector(".main__left").style.flex = "1";
  document.querySelector(".main__right").style.display = "none";
  document.querySelector(".header__back").style.display = "none";
});

showChat.addEventListener("click", () => {
  document.querySelector(".main__right").style.display = "flex";
  document.querySelector(".main__right").style.flex = "1";
  document.querySelector(".main__left").style.display = "none";
  document.querySelector(".header__back").style.display = "block";
});

let peer;
const userName = prompt("Enter your name");
let brokeringId = null;
let myUserId = +prompt("Choose User ID"); // For random User id, For mobile please use dynamic User id



let peers = {};
let myVideoStream;
let uploader;
let activeStream = "";

// @ REACT NATIVE DEV
//  PLEASE NOTE THAT VIDEO STREAM REPRESENT BOTH AUDIO AND VIDEO.
// HERE WE HAVE DISABLED VIDEO , SO IN VIDEO STREAM IT WILL ONLY BE AUDIO


const systemMessage = (userName, join = false) => {
    const date = new Date();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    const format = hours >= 12 ? "PM" : "AM";
    hours %= 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? "0" + minutes : minutes;

    messages.innerHTML =
        messages.innerHTML +
        `<div class="message">
        <b><i class="far fa-user-circle"></i> <span> System Message </span> </b>
        <span>${userName} has ${
            join ? "joined" : "left"
        } the meeting ... ${hours}:${minutes}${format}</span>
    </div>`;
};


const socket = io("/", {
    "rejectUnauthorized": false,
    forceNew: true,
    multiplex: false,
});
uploader = new SocketIOFileClient(socket);
socket.on('connect_error', (err) => {
    console.log(`connect_error due to ${err.message}`);
});
socket.on('error', (err) => {
    console.log(`connect_error >>>>>>>> ${err.message}`);
});

socket.on('chat-error', (err) => {
    alert(err);
});

socket.on('connect', () =>{
    peer = new Peer(brokeringId, {
        path: "/peerjs",
        host: "/",
        port: "3030",
        secure: true
    });
    peer.on('error', function (err){
        console.log('peerjs', err);
    })
    peer.on("open", (id) => {
        brokeringId = id;

        navigator.mediaDevices
            .getUserMedia({
                audio: true,
                //video: true,
            })
            .then((stream) => {
                myVideoStream = stream;
                addVideoStream(myVideo, stream);

                peer.on("call", (call) => {
                    console.log('call avyo');
                    call.answer(stream);
                    const video = document.createElement("video");
                    call.on("stream", (userVideoStream) => {
                        addVideoStream(video, userVideoStream);
                    });
                });

                console.log('trying to join room', ROOM_ID);
                socket.emit("join-room", ROOM_ID, brokeringId, myUserId, userName);
                console.log('trying to join room... 1', ROOM_ID);
                socket.emit('connection-request',ROOM_ID,brokeringId, myUserId, userName);
                socket.on("user-connected", (userBrokeringId) => {
                    console.log('requesting connection', myUserId);
                    socket.on("new-user-connected", (remoteBrokeringId, userId, userName) => {
                        console.log(userId, myUserId);
                        if(userId !== myUserId){
                            connectToNewUser(remoteBrokeringId, stream, userId);
                        }
                        systemMessage(userName, true);
                    });

                    socket.emit("participants");
                });

                socket.on("participants", (users) => {
                    // const container = document.querySelector(".main__users__box");
                    const lists = document.getElementById("users");
                    lists.innerHTML = "";
                    lists.textContent = "";

                    users.forEach((user) => {
                        const list = document.createElement("li");
                        list.className = "user";
                        list.innerHTML = `
                            <div class="message">
                                <b><i class="far fa-user-circle"></i> <span> ${user.name.toUpperCase()} </span> &nbsp;&nbsp;
                                <i class="fas fa-microphone${user.audio === false ? "-slash" : ""}"></i>
                                <i class="fas fa-video${user.video === false ? "-slash" : ""}"></i>
                                </b>
                                
                            </div>
                        `;

                        lists.append(list);
                    });
                });

                /***
                 * Start: Not needed for Audio call
                 */
                socket.on("createMessage", (message, remoteUserId, remoteUserName, timestamp) => {
                    messages.innerHTML =
                        messages.innerHTML +
                        `<div class="message">
                            <b><i class="far fa-user-circle"></i> <span> ${
                            myUserId === remoteUserId ? "me" : remoteUserName
                        }</span> </b>
                            <span>${message}</span>
                        </div>`;
                });


                uploader.on('start', function(fileInfo) {
                    console.log('Start uploading', fileInfo);
                });
                uploader.on('stream', function(fileInfo) {

                });

                uploader.on('complete', function(fileInfo) {
                    console.log('Upload Complete', fileInfo);
                    //emit an event for public chat message
                    socket.emit('newFileMessage', fileInfo, myUserId, userName);

                });

                uploader.on('error', function(err) {
                    console.log('Error!', err);

                });

                uploader.on('abort', function(fileInfo) {
                    console.log('Error!', err);
                });


                socket.on('newFileMessage', function(message, remoteUserId, remoteUserName) {
                    let formattedTime = message.createdAt;


                    messages.innerHTML =
                        messages.innerHTML +
                        `<div class="message">
                            <b><i class="far fa-user-circle"></i> <span> ${
                            myUserId === remoteUserId ? "me" : remoteUserName
                        }</span> </b>
                            <span><a target="_blank" href="/files/${message.fileUrl}">${message.fileName}</a></span>
                        </div>`;
                    console.log('This is file url ' + message.fileUrl);
                });
                /***
                 * END: Not needed for Audio call
                 */

            })
            .catch((error) => {
                console.log('errr', error);
            });

        socket.on("user-disconnected", (userId, userName) => {
            peers[userId]?.close();
            systemMessage(userName);
        });
    });
});

const connectToNewUser = (remoteBrokeringId, stream, userId) => {
  const call = peer.call(remoteBrokeringId, stream);
  console.log('call karyo', remoteBrokeringId, userId);
  const video = document.createElement("video");
  call.on("stream", (userVideoStream) => {
      console.log('called - connectToNewUser');
    addVideoStream(video, userVideoStream);
  });
    call.on("close", () => {
        video.remove();
    });
    peers[userId] = call;
};



const addVideoStream = (video, stream) => {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
    videoGrid.append(video);
  });
};

let text = document.querySelector("#chat_message");
let send = document.getElementById("send");
let inputFile = document.getElementById("input-file");
let messages = document.querySelector(".messages");

send.addEventListener("click", (e) => {
  if (text.value.length !== 0) {
    socket.emit("message", text.value);
    text.value = "";
  }
});

text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && text.value.length !== 0) {
    socket.emit("message", text.value);
    text.value = "";
  }
});

const inviteButton = document.querySelector("#inviteButton");
const muteButton = document.querySelector("#muteButton");
const stopVideo = document.querySelector("#stopVideo");
muteButton.addEventListener("click", () => {
  const enabled = myVideoStream.getAudioTracks()[0].enabled;
  if (enabled) {
    socket.emit("mute-mic");
    myVideoStream.getAudioTracks()[0].enabled = false;
    html = `<i class="fas fa-microphone-slash"></i>`;
    muteButton.classList.toggle("background__red");
    muteButton.innerHTML = html;
  } else {
    socket.emit("unmute-mic");
    myVideoStream.getAudioTracks()[0].enabled = true;
    html = `<i class="fas fa-microphone"></i>`;
    muteButton.classList.toggle("background__red");
    muteButton.innerHTML = html;
  }
});

/*stopVideo.addEventListener("click", () => {
  const enabled = myVideoStream.getVideoTracks()[0].enabled;
  if (enabled) {
    myVideoStream.getVideoTracks()[0].enabled = false;
    html = `<i class="fas fa-video-slash"></i>`;
    stopVideo.classList.toggle("background__red");
    stopVideo.innerHTML = html;
  } else {
    myVideoStream.getVideoTracks()[0].enabled = true;
    html = `<i class="fas fa-video"></i>`;
    stopVideo.classList.toggle("background__red");
    stopVideo.innerHTML = html;
  }
});*/

inviteButton.addEventListener("click", (e) => {
  prompt(
    "Copy this link and send it to people you want to meet with",
    window.location.href
  );
});




inputFile.addEventListener('change', (event) => {
    console.log(event.target.files[0].name);
    let fileEl = document.getElementById('input-file');
    uploader.upload(fileEl);
});
function upload_file() {
    inputFile.click();
}


