const express = require("express");
const moment = require("moment");
const fs = require('fs');
const app = express();
let credentials = {key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem'), rejectUnauthorized: false};
const server = require("https").Server(credentials, app);
const { v4: uuidv4 } = require("uuid");
const SocketIOFile = require('socket.io-file');
const { ExpressPeerServer } = require("peer");
let path=require('path');
const { Client } = require('pg');
const firebaseAdmin = require('firebase-admin');
const users = {};
const userIdArray = {};
let rooms = {};
let room_user_details = {};
const serviceAccount = require('./notification-server-key.json');
const https = require("https");

firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount),
});
const messaging = firebaseAdmin.messaging()
require('dotenv').config()

app.set("view engine", "ejs");
const io = require("socket.io")(server, {
    cors: {
        origin: '*'
    },
    rejectUnauthorized: false
});

const peerServer = ExpressPeerServer(server, {
    debug: true,
    rejectUnauthorized: false,
    ssl: {
        key: fs.readFileSync('key.pem'),
        certificate: fs.readFileSync('cert.pem')
    }
});

const client = new Client({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
});
client.connect();

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Credentials", "true"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Methods", "*"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Headers", "*");
    next();
});
app.use("/peerjs", peerServer);
app.use(express.static("public"));
app.use( express.static(__dirname + '/node_modules/socket.io-file-client'));

/*app.get("/", (req, res) => {
    res.redirect(`/${uuidv4()}`);
});*/

app.get("/:room", (req, res) => {
    res.render("room", { roomId: req.params.room });
});
app.get('/files/:file(*)', function(req, res, next){ // this routes all types of file

    let path=require('path');
    const file = req.params.file;

    path = path.resolve(".")+'/data/'+file;
    res.download(path); // magic of download fuction

});

io.on("connection", (socket) => {
    socket.on("join-room", (roomId, brokeringId, userId, userName, userProfilePic) => {
        userId = userId.toString();
        roomId = roomId.toString();
        getRoomUserDetails(roomId);
        client
            .query('SELECT * FROM rooms WHERE id = $1', [roomId])
            .then(res => {
                if(res.rows && res.rows[0]){
                    let roomType = res.rows[0].room_type;
                    let roomDetails = res.rows[0];

                    console.log('join-request', userId, roomId, brokeringId);
                    let isNewRoom = false;
                    if (users[roomId]) users[roomId].push({ id: userId, name: userName, video: false, audio: true, startTime: moment(), userProfilePic: userProfilePic, roomType: roomType });
                    else users[roomId] = [{ id: userId, name: userName, video: false, audio: true, startTime: moment(), userProfilePic: userProfilePic, roomType: roomType }];

                    if(!userIdArray[roomId]){
                        userIdArray[roomId] = [];
                    }
                    if(!userIdArray[roomId].includes(userId.toString())){
                        userIdArray[roomId].push(userId);
                    }

                    if (rooms[roomId]) {
                        rooms[roomId].totalUser += 1;
                    }
                    else {
                        isNewRoom = true;
                        rooms[roomId] = { hostUserId: userId, hostUserName: userName, totalUser: 1, startTime: moment(),
                            userProfilePic: userProfilePic, roomType: roomType, roomDetails: roomDetails };
                    }

                    socket.join(roomId);

                    if(isNewRoom && roomType === 'Audio'){
                        broadcastNotification(roomId, userId, 'AUDIO_START', 'Audio call started');
                    }

                    console.log('joined room', userId, roomId);
                    socket.emit("user-connected", brokeringId);
                    socket.on("message", (message) => {
                        io.to(roomId).emit("createMessage", message, userId, userName, moment().format('YYYY-MM-DD hh:mm:ss'), userProfilePic);

                        const query = 'INSERT INTO room_logs (room_id, user_id, message_type, message,created_at,updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id';

                        client.query(query, [roomId, userId, 'Text', message, moment().format('YYYY-MM-DD hh:mm:ss'), moment().format('YYYY-MM-DD hh:mm:ss')],(err, res) => {
                            if (err) {
                                console.error(err);
                            }
                        });

                        broadcastNotification(roomId, userId, 'NEW_CHAT_MESSAGE', message);
                    });

                    io.in(roomId).emit("participants", users[roomId]);

                    socket.on("mute-mic", () => {
                        users[roomId].forEach((user) => {
                            if (user.id == userId) return (user.audio = false);
                        });
                        io.in(roomId).emit("participants", users[roomId]);
                    });

                    socket.on("unmute-mic", () => {
                        users[roomId].forEach((user) => {
                            if (user.id == userId) return (user.audio = true);
                        });
                        io.in(roomId).emit("participants", users[roomId]);
                    });

                    socket.on("disconnect", () => {
                        console.log('disconnect', userId);
                        socket.to(roomId).emit("user-disconnected", userId, userName);
                        userIdArray[roomId] = arrayRemove(userIdArray[roomId], userId);
                        let disconnectedUser;
                        if(users[roomId]){
                            users[roomId].forEach((user) => {
                                if (user.id == userId){
                                    disconnectedUser = user;
                                    user.endTime = moment();
                                    const query = 'INSERT INTO room_logs (room_id, user_id, message_type, stream_start, stream_end, total_time, created_at,updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id';
                                    let timestamp = moment().format('YYYY-MM-DD hh:mm:ss');
                                    let duration = moment.duration(user.endTime.diff(user.startTime));
                                    // duration in hours
                                    let hours = parseInt(duration.asHours());
                                    let minutes = parseInt(duration.asMinutes()) % 60;
                                    let logType = roomType === 'Audio' ? 'User-Call-Log' : 'User-Chat-Log';

                                    client.query(query, [roomId, userId, logType, user.startTime.format('YYYY-MM-DD hh:mm:ss'), user.endTime.format('YYYY-MM-DD hh:mm:ss'), `${hours}:${minutes}`, timestamp, timestamp],(err, res) => {
                                        if (err) {
                                            console.error(err);
                                        }
                                    });
                                    if(logType === 'User-Call-Log' && minutes > 1){
                                        const pointQuery = 'INSERT INTO post_points (user_id, room_id, action, points, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id';
                                        timestamp = moment().format('YYYY-MM-DD hh:mm:ss');
                                        client.query(pointQuery, [userId, roomId, 11, 15, timestamp],(err, res) => {
                                            if (err) {
                                                console.error(err);
                                            }
                                        });
                                    }
                                }
                            });

                            users[roomId] = users[roomId].filter((user) => user.id != userId);
                            if (users[roomId].length === 0) {
                                rooms[roomId].endTime = moment();
                                const query = 'INSERT INTO room_logs (room_id, user_id, message_type, stream_start, stream_end, total_time, created_at,updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id';
                                let timestamp = moment().format('YYYY-MM-DD hh:mm:ss');
                                let duration = moment.duration(rooms[roomId].endTime.diff(rooms[roomId].startTime));
                                let hours = parseInt(duration.asHours());
                                let minutes = parseInt(duration.asMinutes()) % 60;
                                let logType = roomType === 'Audio' ? 'Room-Call-Log' : 'Room-Chat-Log';

                                client.query(query, [roomId, userId, logType, rooms[roomId].startTime.format('YYYY-MM-DD hh:mm:ss'), rooms[roomId].endTime.format('YYYY-MM-DD hh:mm:ss'), `${hours}:${minutes}`, timestamp, timestamp],(err, res) => {
                                    if (err) {
                                        console.error(err);
                                    }
                                });
                                delete users[roomId];
                                delete rooms[roomId];
                            }
                            else io.in(roomId).emit("participants", users[roomId]);
                        }

                    });


                    socket.on('newFileMessage',(fileInfo, userId, userName) =>{
                        const query = 'INSERT INTO room_logs (room_id, user_id, message_type, message, attachment,created_at,updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id';

                        client.query(query, [roomId, userId, 'Attachment', fileInfo.originalFileName, fileInfo.name, moment().format('YYYY-MM-DD hh:mm:ss'), moment().format('YYYY-MM-DD hh:mm:ss')],(err, res) => {
                            if (err) {
                                console.error(err);
                            }
                        });
                        io.to(roomId).emit('newFileMessage', {fileUrl: fileInfo.name, fileName: fileInfo.originalFileName,createdAt: moment().valueOf()}, userId, userName);
                    });
                } else {
                    socket.emit("chat-error", 'INVALID-ROOM');
                }

            })
            .catch(e => {
                console.error(e.message);
                socket.emit("chat-error", 'INVALID-ROOM');
            })
    });
    socket.on('error', (error)=>{
        console.log(error);
    });
    socket.on('connection-request',(roomId,brokeringId, userId, userName, userProfilePic)=>{
        io.to(roomId).emit('new-user-connected',brokeringId, userId, userName, userProfilePic);
    })

    const uploader = new SocketIOFile(socket, {
        uploadDir: 'data',							// simple directory,		// chrome and some of browsers checking mp3 as 'audio/mp3', not 'audio/mpeg'
        maxFileSize: 10194304, 						// 4 MB. default is undefined(no limit)
        chunkSize: 10240,							// default is 10240(1KB)
        transmissionDelay: 0,						// delay of each transmission, higher value saves more cpu resources, lower upload speed. default is 0(no delay)
        overwrite: false, 							// overwrite file if exists, default is true.
        rename: function(filename, fileInfo) {
            let file = path.parse(filename);
            let fname = uuidv4().replace(/\-/g, '_');
            let ext = file.ext;
            return `${fname}${ext}`;
        }
    });
    uploader.on('start', (fileInfo) => {
        console.log('Start uploading');
        console.log(fileInfo);
    });
    uploader.on('stream', (fileInfo) => {
        console.log(`${fileInfo.wrote} / ${fileInfo.size} byte(s)`);
    });
    uploader.on('complete', (fileInfo) => {
        console.log('Upload Complete.');
        console.log(fileInfo);
    });
    uploader.on('error', (err) => {
        console.log('Error!', err);
    });
    uploader.on('abort', (fileInfo) => {
        console.log('Aborted: ', fileInfo);
    });



});

const getRoomUserDetails = (roomId) => {
    let detail_query = `SELECT u.id, ru.room_id, ru.is_notification as room_notification, u.fcm_token,
            (select is_notification from user_group ug where ug.group_id = r.group_id and ug.user_id = u.id) as group_notification,
            (select array_agg(blocked_user_id) from block_user_group_notifications bun where bun.user_id = u.id and bun.group_id = r.group_id) as blocked_users
            from 
            room_users ru
            INNER JOIN rooms r on r.id = ru.room_id
            INNER JOIN users u on u.id = ru.user_id
            Where ru.room_id = $1;`;
    return client
        .query(detail_query, [roomId])
        .then(res => {
            if(res.rows && res.rows[0]){
                let list = {};
                for (let i = 0; i < res.rows.length; i++){
                    let user = res.rows[i];
                    list[user.id] = user;
                }
                //console.log(list);
                room_user_details[roomId] = list;
            } else {
                console.error('User details not found.');
            }
        })
        .catch(e => {
            console.error(e.message);
        })
}

const broadcastNotification = (roomId, userId, notification_type, message) => {
    console.log(room_user_details, userIdArray);
    if(room_user_details[roomId] && userIdArray[roomId]){
        let title = "";
        if(rooms[roomId]){
            title = rooms[roomId].roomDetails.title;
        }
        if(room_user_details[roomId][userId]){
            console.log(room_user_details[roomId][userId]);
            message = room_user_details[roomId][userId].first_name + " " + room_user_details[roomId][userId].last_name + ": " + message;
        }
        let tokens = [];
        for (const key in room_user_details[roomId]) {
            let user = room_user_details[roomId][key];
            if(user.id == userId || userIdArray[roomId].includes(user.id.toString())){
                continue;
            }
            if(user.fcm_token && user.room_notification && user.group_notification){
                if(user.blocked_users && user.blocked_users.includes(userId.toString())){
                    continue;
                }
                tokens.push(user.fcm_token);
                createNotificationLog(user.id, roomId, message, notification_type);
            }
        }
        if(tokens){
            sendMessage(title, message, tokens, roomId, userId, notification_type);
        }
    }
};

const sendMessage = (title, message, registrationTokens, roomId, userId, notification_type) => {
    if(registrationTokens.length == 0){
        return false;
    }
    const notificationMessage = {
        data: {
            details: JSON.stringify({
                user_id: userId.toString(),
                redirect_id: roomId.toString(),
                notification_type: notification_type
            })
        },
        notification: {
            title: title,
            body: message
        },
        tokens: registrationTokens,
    };

    try {
        messaging.sendMulticast(notificationMessage)
            .then((response) => {
                if (response.failureCount > 0) {
                    const failedTokens = [];
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success) {
                            failedTokens.push([registrationTokens[idx], resp.error.message]);
                        }
                    });
                    console.log('List of tokens that caused failures: ' + failedTokens);
                }
            });
    } catch (err){
        console.log(err);
    }

};

//Using legacy method api key directly
const sendMessageLegacy = (title, message, registrationTokens) => {
    if(registrationTokens.length == 0){
        return false;
    }
    let options = {
        hostname: 'fcm.googleapis.com',
        path: '/fcm/send',
        method: 'POST',
        headers: {
            'Authorization': 'key=AAAAp7HfXrA:APA91bFQHxctqDS8m08XT-POKdadUthJAhIJ9DPfHjWtZCfvpja-_CD-GPcabRfjWYi8YhenY2auf5iAtpQvJw1NU0AhodIfBt1SVXjPKOu877nOqGK-qLd56hiv7DnhaI6r3YQKIesG',
            'Content-Type' : 'application/json'
        }
    };

    for(let i = 0 ; i < registrationTokens.length; i++){
        let notificationMessage = {
            data: {
                date: moment().add(1, 'day').toString()
            },
            notification: {
                title: title,
                body: message
            },
            to: registrationTokens[i],
        };

        try {
            let request = https.request(options, function(resp) {
                resp.setEncoding('utf8');
                resp.on('data', function(data) {
                    console.log('Message sent to Firebase for delivery, response:');
                    console.log(data);
                });
            });
            request.on('error', function(err) {
                console.log('Unable to send message to Firebase');
                console.log(err);
            });
            request.write(JSON.stringify(notificationMessage));
            request.end();
        } catch (err){
            console.log(err);
        }
    }
};

function arrayRemove(arr, value) {

    return arr.filter(function(ele){
        return ele != value;
    });
}

function createNotificationLog(userId, redirectId, message, notification_type){
    const query = 'INSERT INTO notifications (user_id, redirect_id, message, notification_type, is_read,created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id';

    client.query(query, [userId, redirectId, message, notification_type, 0, moment().format('YYYY-MM-DD hh:mm:ss')],(err, res) => {
        if (err) {
            console.error(err);
        }
    });
}

server.listen(process.env.PORT || 3030);
