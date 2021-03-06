const data = require("./level");
const express = require("express");
const moment = require("moment");
const path = require("path");

const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);

require("dotenv").config();

// app.use(express.static('build')); // make whole build folder public so we can access files inside

// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'index.html'));
// });
// we will create standalone server on herokku

server.listen(process.env.PORT || 8081, () => {
  // gives us any avaiable port provided by heroku or listens to port 8081
  console.log("Listening on", server.address().port);
});

server.lastPlayerID = -1; // Keep track of the last id assigned to a new player
// start counting from 0, so our array won't be empty at the beggining

// (function() {
//   var emit = io.emit,
//     onevent = io.onevent;
//
//   io.emit = function() {
//     console.log("***", "EMIT", Array.prototype.slice.call(arguments));
//     emit.apply(io, arguments);
//   };
//   io.onevent = function(packet) {
//     console.log("***", "ON", Array.prototype.slice.call(packet.data || []));
//     onevent.apply(io, arguments);
//   };
// })();

function getAllPlayers() {
  const players = [];
  Object.keys(io.sockets.connected).map(socketID => {
    const player = io.sockets.connected[socketID].player; // eslint-disable-line
    if (player) players.push(player);
    return null;
  });
  return players;
}

function playerOnXY({ x, y }) {
  return getAllPlayers().find(player => {
    return player.x === x && player.y === y;
  });
}

function updateUserPosition(user, { x, y }) {
  return {
    ...user,
    x,
    y,
    last_move: moment()
  };
}

function increasePlayersDeathCount(user) {
  return {
    ...user,
    deathCount: user.deathCount += 1,
  };
}


function findPlayerSocketIdByName(name) {
  return Object.keys(io.sockets.connected).find(socketID => {
    const player = io.sockets.connected[socketID].player;
    return player.name === name;
  });
}

const defaultCoords = { x: 20, y: 20 };
const hitDistance = 3;

io.on("connection", socket => {
  socket.on("get_map", () => {
    socket.emit("map", data); // send map data
    getAllPlayers().map(player =>
      io.to(`${socket.id}`).emit("user_joined", player)
    ); // spawn every other player before creating new one

    socket.player = {
      // define new player object
      id: (server.lastPlayerID += 1),
      ...defaultCoords,
      speed: 220,
      last_move: moment(),
      deathCount: 0,
      name: socket.request._query.name // random name created on frontend side of app
    };

    addPlayer(socket.player);
  });

  // setInterval( () => {
  //   console.log(
  //     getAllPlayers());
  // }, 5000);

  function addPlayer(player) {
    if (player.name === socket.player.name) {
      // if player died because of himself
      socket.player = { ...socket.player, ...defaultCoords };
      socket.emit("self_joined", socket.player);
      socket.broadcast.emit("user_joined", socket.player);
      leaderboard();
    } else {
      // if he was shot
      const newPlayerData = {
        ...player,
        ...defaultCoords,
        last_move: moment()
      };
      const newPlayerSocketId = findPlayerSocketIdByName(player.name);
      io.sockets.connected[newPlayerSocketId].player = newPlayerData;

      io.to(`${newPlayerSocketId}`).emit("self_joined", newPlayerData);
      Object.keys(io.sockets.connected)
        .filter(socketId => socketId !== newPlayerSocketId)
        .map(filteredSocketId => {
          io.to(`${filteredSocketId}`).emit("user_joined", newPlayerData);
        });
    }
    // socket.player = { ...socket.player, ...defaultCoords }
    // console.log(player);
    // const newPlayerData = { ...player, ...defaultCoords };
    // console.log('sending new player!', newPlayerData);
    // const newPlayerSocketId = findPlayerSocketIdByName(player.name);
    // if (socket.player.name === player.name) {
    //   socket.player = { ...socket.player, ...defaultCoords };
    // }
    // io.sockets.connected[newPlayerSocketId].player = newPlayerData;
    // io.to(`${newPlayerSocketId}`).emit('self_joined', newPlayerData); // sending to individual socketid (private message) about new player
    // Object.keys(io.sockets.connected).filter(socketId => ![newPlayerSocketId].includes(socketId)).map(socket => {
    //   io.to(`${socket}`).emit('user_joined', newPlayerData);
    // })

    // socket.broadcast.emit('user_joined', newPlayerData); // lete everyone else spawn new player
  }
  function leaderboard() {
    io.emit("leaderboard", getAllPlayers());
  }

  function lose(data) {
    const deadPlayer = io.sockets.connected[findPlayerSocketIdByName(data.name)].player;
    deadPlayer.deathCount += 1;

    io.emit("lose", data);
    leaderboard();
    setTimeout(() => {
      addPlayer(deadPlayer);
    }, 5000);
  }

  // .broadcast.emit sends a message to all connected sockets, except the socket who triggered the callback
  // .emit sends a message to all connected sockets

  socket.on("move", dirObject => {
    let user = socket.player;
    const move_time = Math.round(100000 / (2 * (user.speed - 1) + 120));

    const diff = moment().diff(user.last_move);
    if (diff < move_time * 0.85) {
      return;
    }

    const newCoords = { x: user.x, y: user.y };

    dirObject.dir === "n" && newCoords.y--;
    dirObject.dir === "e" && newCoords.x++;
    dirObject.dir === "w" && newCoords.x--;
    dirObject.dir === "s" && newCoords.y++;
    if (playerOnXY(newCoords)) {
      return;
    }

    const emitData = { ...newCoords, name: user.name, move_time };
    socket.player = updateUserPosition(user, { ...newCoords });
    if (data.data[newCoords.y][newCoords.x] < 0) {
      // if user is outside of the map he/she loses
      lose(emitData);
    } else {
      io.emit("move", emitData); // else he can move
    }
  });

  socket.on("turn", dirObject => {
    const direction = dirObject.dir;
    socket.broadcast.emit("turn", { ...socket.player, dir: direction });
  });

  socket.on("fire", fireData => {
    socket.broadcast.emit("fire", {
      ...fireData,
      username: socket.player.name
    });
  });

  socket.on("hit", hitData => {
    const playerSockedId = findPlayerSocketIdByName(hitData.username);
    let user = io.sockets.connected[playerSockedId].player;
    // console.log(user);
    let newCoords = { x: user.x, y: user.y };

    const move_time = Math.round(100000 / (2 * (user.speed - 1) + 120));

    const diff = moment().diff(user.last_move);
    if (diff < move_time * 0.85) {
      return;
    }

    _checkForObstacleLoop = (coords, direction, increment) => {
      const horizontalDirection = ["e", "w"].includes(direction);
      let checkCoords = JSON.parse(JSON.stringify(coords));
      let finalCoords = JSON.parse(JSON.stringify(coords));

      for (let i = 1; i <= hitDistance; i++) {
        if (horizontalDirection)
          checkCoords = { x: checkCoords.x + increment, y: checkCoords.y };
        else checkCoords = { x: checkCoords.x, y: checkCoords.y + increment };

        if (!playerOnXY(checkCoords)) finalCoords = checkCoords;
        else break;
      }
      return finalCoords;
    };

    newCoords = _checkForObstacleLoop(
      newCoords,
      hitData.dir,
      ["n", "w"].includes(hitData.dir) ? -1 : 1
    );

    const emitData = {
      ...newCoords,
      name: user.name,
      move_time,
      speed: user.speed
    };
    io.sockets.connected[playerSockedId].player = updateUserPosition(user, {
      ...newCoords
    });
    if (data.data[newCoords.y][newCoords.x] < 0) {
      // if user is outside of the map he/she loses
      lose(emitData);
    } else {
      io.emit("fly", emitData); // else he can move
    }
  });

  // // io.emit(move, {}); // handle player movement
  // io.emit(lose, {}); // indicate if player died to display animation
  // // io.emit(user_joined, {}); // if new user joined
  // // io.emit(self_joined, {}); // if I joined server
  // io.emit(fly, {}); // player hitted by cat rocket
  // io.emit(fly_lose, {}); // player hitted by cat rocket and died
  // io.emit(fire, {}); // create cat missle
  // io.emit(turn, {}); // rotate player - animation
  // io.emit(destroy_field, {}); // remove tile from map

  socket.on("disconnect", () => {
    io.emit("lose", socket.player);
    leaderboard();
    console.log("player disconnected", socket.player);
  });
});
