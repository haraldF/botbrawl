export type BotMoveMode = 'none' | 'move' | 'shoot' | 'sniper';

export interface BotMove {
    botId: number;
    mode: BotMoveMode;
    /** Normalized direction vector x component. */
    directionX: number;
    /** Normalized direction vector y component. */
    directionY: number;
    /** Distance to move (only meaningful for mode === 'move'). */
    distance: number;
}

export interface BotPosition {
    botId: number;
    x: number;
    y: number;
}

export interface BarrierPosition {
    x: number;
    y: number;
}

export interface Move {
    /** 1 for the host (player 1), 2 for the joiner (player 2). */
    playerId: 1 | 2;
    /** Round index this move belongs to (0-based, monotonically increasing). */
    moveId: number;
    moves: BotMove[];
}

export interface NewGameRequest {
    clientVersion: string;
    barrierPositions: BarrierPosition[];
    player1BotPositions: BotPosition[];
    player2BotPositions: BotPosition[];
}

export interface GameState {
    moveId: number;
    /** Most recent completed round whose positions are stored in this state. */
    stateMoveId: number;
    barrierPositions: BarrierPosition[];
    player1BotPositions: BotPosition[];
    player2BotPositions: BotPosition[];
}

/** Host-provided final positions for a completed multiplayer round. */
export interface GameStateUpdate {
    playerId: 1;
    moveId: number;
    player1BotPositions: BotPosition[];
    player2BotPositions: BotPosition[];
}

export interface RoundMovesResponse {
    moveId: number;
    player1Move: Move;
    player2Move: Move;
}
