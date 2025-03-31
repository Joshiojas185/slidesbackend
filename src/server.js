const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['my-custom-header'],
        credentials: true
    }
});

app.use(cors());
app.use(express.static('host'));
app.use(express.static('slides'));
app.use(express.static('viewer'));
app.use('/uploads', express.static('uploads'));

app.use(express.static(path.join(__dirname, '../host'))); // Serve frontend files
app.use(express.static(path.join(__dirname,'../viewer')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploads from the new location

// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'host', 'login.html'));
// });

const uploadFolder = path.join(__dirname, 'uploads'); // Update this path

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

const clearUploadsFolder = () => {
    return new Promise((resolve, reject) => {
        fs.readdir(uploadFolder, (err, files) => {
            if (err) {
                console.error("Error reading upload folder:", err);
                reject(err);
                return;
            }
            let deletePromises = files.map(file =>
                fs.promises.unlink(path.join(uploadFolder, file))
            );
            Promise.all(deletePromises)
                .then(() => resolve())
                .catch(err => reject(err));
        });
    });
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadFolder);
    },
    filename: (req, file, cb) => {
        cb(null, "slides.pdf");
    }
});

const upload = multer({ storage });

app.post("/upload", async (req, res) => {
    try {
        await clearUploadsFolder();
        upload.single("pdf")(req, res, (err) => {
            if (err) {
                return res.status(500).json({ message: "File upload error", error: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }
            res.json({ message: "File uploaded successfully as slides.pdf" });
        });
    } catch (error) {
        res.status(500).json({ message: "Error clearing folder", error: error.message });
    }
});

let rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomName, playerName) => {
        socket.join(roomName);
        
        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: [],
                host: null,
                pdfPath: path.join(__dirname, 'uploads', 'slides.pdf'),
                currentPage: 1
            };
        }

        rooms[roomName].players.push({ id: socket.id, name: playerName });

        if (roomName === 'tcs') {
            if (playerName === 'tcshost') {
                rooms[roomName].host = socket.id;
                io.to(socket.id).emit('hostAssigned');
            }
        } else {
            if (rooms[roomName].host === null) {
                rooms[roomName].host = socket.id;
                io.to(socket.id).emit('hostAssigned');
            }
        }

        io.to(roomName).emit('updatePlayers', rooms[roomName].players);
        
        if (socket.id === rooms[roomName].host) {
            io.to(socket.id).emit('hostAssigned');
        }

        if (rooms[roomName].pdfPath) {
            io.to(socket.id).emit('pdfUploaded', `/uploads/slides.pdf`);
            io.to(socket.id).emit('pageChanged', rooms[roomName].currentPage);
        }
    });

    socket.on('nextPage', (roomName) => {
        if (rooms[roomName].pdfPath) {
            rooms[roomName].currentPage++;
            io.to(roomName).emit('pageChanged', rooms[roomName].currentPage);
        }
    });

    socket.on('prevPage', (roomName) => {
        if (rooms[roomName].currentPage > 1) {
            rooms[roomName].currentPage--;
            io.to(roomName).emit('pageChanged', rooms[roomName].currentPage);
        }
    });

    socket.on('goToPage', (roomName, pageNumber) => {
        if (rooms[roomName] && rooms[roomName].pdfPath) {
            rooms[roomName].currentPage = pageNumber;
            io.to(roomName).emit('pageChanged', rooms[roomName].currentPage);
        }
    });

    socket.on('disconnect', () => {
        for (const roomName in rooms) {
            rooms[roomName].players = rooms[roomName].players.filter(p => p.id !== socket.id);
            if (socket.id === rooms[roomName].host) {
                rooms[roomName].host = null;
            }
            io.to(roomName).emit('updatePlayers', rooms[roomName].players);
        }
    });
});

const PORT = process.env.PORT || 5000;
// const HOST = '10.33.0.21';
// const HOST = '0.0.0.0';
const HOST = '192.168.29.153';

server.listen(PORT, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});