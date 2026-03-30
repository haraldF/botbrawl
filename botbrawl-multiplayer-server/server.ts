import { randomUUID } from 'node:crypto';
import * as http from 'node:http';

const PORT = parseInt(process.env.BOTBRAWL_MULTIPLAYER_SERVER_PORT ?? "3000");
const LongPollTimeout = 30 * 1000; // 30 seconds

interface BotMove {
    botId: number;
    direction: number;
    mode: 'shoot' | 'move';
}

interface Move {
    playerId: number;
    moveId: number;
    moves: BotMove[];
}

interface Game {
    lastActivity: number;
    moveId: number;
    player1Move?: Move;
    player2Move?: Move;
    listeners: Set<() => void>;
}

interface GameError extends Error
{
    statusCode: number;
    message: string;
}

function waitForMoves(game: Game): Promise<void> {
    return new Promise((resolve, reject) => {
        const callback = () => {
            if (game.player1Move !== undefined && game.player2Move !== undefined) {
                game.listeners.delete(callback);
                resolve();
            }
        };

        game.listeners.add(callback);

        setTimeout(() => {
            game.listeners.delete(callback);
            reject({ statusCode: 504, message: 'Timeout waiting for moves' });
        }, LongPollTimeout);
    });
}

function isMove(obj: any): obj is BotMove {
    return typeof obj === 'object' &&
        typeof obj.botId === 'number' &&
        typeof obj.direction === 'number' &&
        (obj.mode === 'shoot' || obj.mode === 'move');
}

function isMoves(obj: any): obj is Move {
    return typeof obj === 'object' &&
        typeof obj.playerId === 'number' &&
        typeof obj.moveId === 'number' &&
        Array.isArray(obj.moves) &&
        obj.moves.every(isMove);
}

function isGameError(obj: any): obj is GameError
{
    return typeof obj === 'object' &&
        obj !== null &&
        typeof obj.statusCode === 'number' &&
        typeof obj.message === 'string';
}

interface GameResponse {
    message: string | object;
}

const games = new Map<string, Game>();

function cleanupInactiveGames() {
    const now = Date.now();
    for (const [gameId, game] of games) {
        if (now - game.lastActivity > 60 * 60 * 1000) { // 1 hour
            console.log(`Cleaning up inactive game: ${gameId}`);
            games.delete(gameId);
        }
    }
}

// Clean up inactive games every hour
setInterval(cleanupInactiveGames, 60 * 60 * 1000);

async function toJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                resolve(data);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function health()
{
    return { message: 'OK' };
}

async function newGame()
{
    const gameId = randomUUID();
    games.set(gameId, { lastActivity: Date.now(), moveId: 0, listeners: new Set() });

    return { message: { gameId } };
 }

async function deleteGame(gameId: string)
{
    if (!games.has(gameId)) {
        throw { statusCode: 404, message: 'Game not found' };
    }
    games.delete(gameId);

    return { message: 'Game deleted' };
}

async function handleMove(gameId: string, move: Move)
{
    const game = games.get(gameId);
    if (!game) {
        throw { statusCode: 404, message: 'Game not found' };
    }

    if (move.moveId != game.moveId) {
        throw { statusCode: 409, message: 'Move ID mismatch' };
    }

    game.lastActivity = Math.max(game.lastActivity, Date.now());
    if (move.playerId === 0) {
        game.player1Move = move;
    } else if (move.playerId === 1) {
        game.player2Move = move;
    } else {
        throw { statusCode: 400, message: 'Invalid playerId' };
    }

    for (const listener of game.listeners) {
        listener();
    }

    return { message: 'Move received' };
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<GameResponse>
{
    const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/botbrawl/health') {
        return await health();
    }

    if (req.method === 'POST' && url.pathname === '/botbrawl/game') {
        return await newGame();
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/botbrawl/game/')) {
        const gameId = url.pathname.split('/')[3] ?? '';
        return await deleteGame(gameId);
    }

    if (req.method === 'POST' && url.pathname.startsWith('/botbrawl/game/')) {
        const gameId = url.pathname.split('/')[3] ?? '';
        const move = await toJson(req);
        if (!isMoves(move)) {
            throw { statusCode: 400, message: 'Invalid Move format' };
        }

        return await handleMove(gameId, move);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/botbrawl/game/')) {
        const gameId = url.pathname.split('/')[3] ?? '';
        const game = games.get(gameId);
        if (!game) {
            throw { statusCode: 404, message: 'Game not found' };
        }

        if (game.player1Move === undefined || game.player2Move === undefined) {
            await waitForMoves(game);
        }

        return { message: { player1Move: game.player1Move, player2Move: game.player2Move, moveId: game.moveId } };
    }

    throw { statusCode: 404, message: 'Not Found' };
}

const server = http.createServer(async (req, res) => {
    try {
        console.log(`Received request: ${req.method} ${req.url}`);

        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.statusCode = 204;
            res.end();
            return;
        }

        const response = await handleRequest(req, res);
        if (typeof response.message === 'object') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(response.message));
        } else {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(response.message);
        }
    } catch (error) {
        console.error('Error handling request:', error);
        if (isGameError(error)) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = error.statusCode;
            res.end(error.message);
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 500; // Internal Server Error
            res.end();
        }
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
