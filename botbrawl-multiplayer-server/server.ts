import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { BotMove, Move, NewGameRequest, GameState } from '../src/types.js';

const PORT = parseInt(process.env.BOTBRAWL_MULTIPLAYER_SERVER_PORT ?? "3001");
const LongPollTimeout = 30 * 1000; // 30 seconds
const MaxRoundsKept = 32; // Keep last N rounds in memory per game.

type Callback = () => void;

interface Round {
    player1Move?: Move;
    player2Move?: Move;
}

interface Game extends GameState {
    lastActivity: number;

    /** Moves received per round, keyed by moveId. */
    rounds: Map<number, Round>;

    /** Highest moveId for which both players have submitted moves. */
    completedMoveId: number;

    // Set of callbacks to notify when any move is received
    listeners: Set<Callback>;
}

function isNewGameRequest(obj: any): obj is NewGameRequest {
    return typeof obj === 'object' &&
        typeof obj.clientVersion === 'string' &&
        Array.isArray(obj.barrierPositions) &&
        obj.barrierPositions.every((bp: any) => typeof bp.x === 'number' && typeof bp.y === 'number') &&
        Array.isArray(obj.player1BotPositions) &&
        obj.player1BotPositions.every((bp: any) => typeof bp.botId === 'number' && typeof bp.x === 'number' && typeof bp.y === 'number') &&
        Array.isArray(obj.player2BotPositions) &&
        obj.player2BotPositions.every((bp: any) => typeof bp.botId === 'number' && typeof bp.x === 'number' && typeof bp.y === 'number');
}

interface GameError extends Error
{
    statusCode: number;
    message: string;
}

function waitForMoves(game: Game, moveId: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const round = game.rounds.get(moveId);
        if (round && round.player1Move && round.player2Move) {
            resolve();
            return;
        }

        const callback = () => {
            const r = game.rounds.get(moveId);
            if (r && r.player1Move && r.player2Move) {
                game.listeners.delete(callback);
                clearTimeout(timeoutHandle);
                resolve();
            }
        };

        game.listeners.add(callback);

        const timeoutHandle = setTimeout(() => {
            game.listeners.delete(callback);
            reject({ statusCode: 504, message: 'Timeout waiting for moves' });
        }, LongPollTimeout);
    });
}

function isMove(obj: any): obj is BotMove {
    return typeof obj === 'object' &&
        typeof obj.botId === 'number' &&
        typeof obj.directionX === 'number' &&
        typeof obj.directionY === 'number' &&
        typeof obj.distance === 'number' &&
        (obj.mode === 'none' || obj.mode === 'move' || obj.mode === 'shoot' || obj.mode === 'sniper');
}

function isMoves(obj: any): obj is Move {
    return typeof obj === 'object' &&
        (obj.playerId === 1 || obj.playerId === 2) &&
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

async function newGame(newGameRequest: NewGameRequest)
{
    const gameId = randomUUID();
    games.set(gameId, {
        lastActivity: Date.now(),
        moveId: 0,
        rounds: new Map(),
        completedMoveId: -1,
        listeners: new Set(),
        barrierPositions: newGameRequest.barrierPositions.map(bp => ({ x: bp.x, y: bp.y })),
        player1BotPositions: newGameRequest.player1BotPositions.map(bp => ({ botId: bp.botId, x: bp.x, y: bp.y })),
        player2BotPositions: newGameRequest.player2BotPositions.map(bp => ({ botId: bp.botId, x: bp.x, y: bp.y }))
    });

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

async function gameState(game: Game)
{
    return {
        message: {
            moveId: game.moveId,
            barrierPositions: game.barrierPositions,
            player1BotPositions: game.player1BotPositions,
            player2BotPositions: game.player2BotPositions
        }
    };
}

async function handleMove(gameId: string, move: Move)
{
    const game = games.get(gameId);
    if (!game) {
        throw { statusCode: 404, message: 'Game not found' };
    }

    if (move.moveId < 0) {
        throw { statusCode: 400, message: 'Invalid moveId' };
    }

    game.lastActivity = Math.max(game.lastActivity, Date.now());

    let round = game.rounds.get(move.moveId);
    if (!round) {
        round = {};
        game.rounds.set(move.moveId, round);
    }

    if (move.playerId === 1) {
        round.player1Move = move;
    } else if (move.playerId === 2) {
        round.player2Move = move;
    } else {
        throw { statusCode: 400, message: 'Invalid playerId' };
    }

    if (round.player1Move && round.player2Move && move.moveId > game.completedMoveId) {
        game.completedMoveId = move.moveId;
        game.moveId = move.moveId + 1;
        // Drop old rounds to avoid unbounded growth.
        for (const id of game.rounds.keys()) {
            if (id < move.moveId - MaxRoundsKept) {
                game.rounds.delete(id);
            }
        }
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
        const newGameRequest = await toJson(req);
        if (!isNewGameRequest(newGameRequest)) {
            throw { statusCode: 400, message: 'Invalid New Game Request format' };
        }
        return await newGame(newGameRequest);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/botbrawl/game/')) {
        const gameId = url.pathname.split('/')[3] ?? '';
        return await deleteGame(gameId);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/botbrawl/game/state/')) {
        const gameId = url.pathname.split('/')[4] ?? '';
        const game = games.get(gameId);
        if (!game) {
            throw { statusCode: 404, message: 'Game not found' };
        }

        return await gameState(game);
    }

    if (req.method === 'POST' && url.pathname.startsWith('/botbrawl/game/move/')) {
        const gameId = url.pathname.split('/')[4] ?? '';
        const move = await toJson(req);
        if (!isMoves(move)) {
            throw { statusCode: 400, message: 'Invalid Move format' };
        }

        return await handleMove(gameId, move);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/botbrawl/game/move/')) {
        const gameId = url.pathname.split('/')[4] ?? '';
        const game = games.get(gameId);
        if (!game) {
            throw { statusCode: 404, message: 'Game not found' };
        }

        const moveIdParam = url.searchParams.get('moveId');
        if (moveIdParam === null) {
            throw { statusCode: 400, message: 'Missing moveId query parameter' };
        }
        const requestedMoveId = parseInt(moveIdParam, 10);
        if (!Number.isFinite(requestedMoveId) || requestedMoveId < 0) {
            throw { statusCode: 400, message: 'Invalid moveId query parameter' };
        }

        const round = game.rounds.get(requestedMoveId);
        if (!round || !round.player1Move || !round.player2Move) {
            await waitForMoves(game, requestedMoveId);
        }

        const ready = game.rounds.get(requestedMoveId)!;
        game.lastActivity = Math.max(game.lastActivity, Date.now());
        return { message: {
            moveId: requestedMoveId,
            player1Move: ready.player1Move,
            player2Move: ready.player2Move,
        } };
    }

    throw { statusCode: 404, message: 'Not Found' };
}

function addCorsHeaders(res: http.ServerResponse)
{
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
    try {
        console.log(`Received request: ${req.method} ${req.url}`);

        if (req.method === 'OPTIONS') {
            addCorsHeaders(res);
            res.statusCode = 204;
            res.end();
            return;
        }

        const response = await handleRequest(req, res);
        if (typeof response.message === 'object') {
            res.setHeader('Content-Type', 'application/json');
            addCorsHeaders(res);
            res.end(JSON.stringify(response.message));
        } else {
            res.setHeader('Content-Type', 'text/plain');
            addCorsHeaders(res);
            res.end(response.message);
        }
    } catch (error) {
        console.error('Error handling request:', error);
        if (isGameError(error)) {
            res.setHeader('Content-Type', 'text/plain');
            addCorsHeaders(res);
            res.statusCode = error.statusCode;
            res.end(error.message);
        } else {
            addCorsHeaders(res);
            res.statusCode = 500; // Internal Server Error
            res.end();
        }
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
