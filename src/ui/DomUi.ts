import { GameConfig } from '../GameConfig.js';

export interface LobbyChoice {
    action: 'create' | 'join';
    serverUrl: string;
    gameId?: string; // Only needed for join
}

export interface DomUiCallbacks {
    onWelcomeStart: () => void;
    onStartRound: () => void;
    onToggleFullscreen: () => void;
    onLobbyChoice: (choice: LobbyChoice) => void;
}

const DEFAULT_SERVER_URL = (() => {
    if (typeof window === 'undefined') return 'http://localhost:3001';
    const { protocol, hostname } = window.location;
    // Default to same host on port 3001 when running locally; users can override in the input.
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
        return `${protocol}//${hostname || 'localhost'}:3001`;
    }
    return `${protocol}//${hostname}:3001`;
})();

/** Encapsulates all DOM element wiring outside the Phaser canvas. */
export class DomUi {
    showWelcome(): void {
        if (this.welcomeBox) this.welcomeBox.style.display = '';
        if (this.gameUi) this.gameUi.style.display = 'none';
        if (this.shareBox) this.shareBox.style.display = 'none';
        if (this.lobbyStatus) this.lobbyStatus.textContent = '';
    }

    showGameUi(): void {
        if (this.welcomeBox) this.welcomeBox.style.display = 'none';
        if (this.gameUi) this.gameUi.style.display = '';
    }

    setStatus(text: string): void {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    setStartEnabled(enabled: boolean): void {
        if (this.startButton) this.startButton.disabled = !enabled;
    }

    scheduleWelcomeReplay(delayMs: number = GameConfig.REPLAY_DELAY): void {
        setTimeout(() => this.showWelcome(), delayMs);
    }

    setLobbyBusy(text: string): void {
        if (this.lobbyStatus) {
            this.lobbyStatus.textContent = text;
            this.lobbyStatus.style.color = '';
        }
    }

    get isStartEnabled(): boolean {
        return !!this.startButton && !this.startButton.disabled;
    }
    private readonly welcomeBox = document.getElementById('welcome-box');
    private readonly welcomeStartButton = document.getElementById('welcome-start') as HTMLButtonElement | null;
    private readonly gameUi = document.getElementById('ui');
    private readonly statusEl = document.getElementById('status');
    private readonly startButton = document.getElementById('start-round') as HTMLButtonElement | null;
    private readonly fullscreenButton = document.getElementById('fullscreen-button') as HTMLButtonElement | null;
    private readonly multiplayerCreateButton = document.getElementById('multiplayer-create') as HTMLButtonElement | null;
    private readonly multiplayerJoinButton = document.getElementById('multiplayer-join') as HTMLButtonElement | null;
    private readonly gameUrlInput = document.getElementById('game-url') as HTMLInputElement | null;
    private readonly lobbyStatus = document.getElementById('lobby-status');
    private readonly createSpinner = document.getElementById('create-spinner');
    private readonly createCancelButton = document.getElementById('create-cancel') as HTMLButtonElement | null;
    private readonly shareBox = document.getElementById('share-box');
    private readonly shareLink = document.getElementById('share-link') as HTMLAnchorElement | null;
    // shareCode is no longer used
    private readonly shareCloseButton = document.getElementById('share-close') as HTMLButtonElement | null;

    bind(callbacks: DomUiCallbacks): void {
        this.welcomeStartButton?.addEventListener('click', callbacks.onWelcomeStart);
        this.startButton?.addEventListener('click', callbacks.onStartRound);
        this.fullscreenButton?.addEventListener('click', callbacks.onToggleFullscreen);

        // Pre-fill from URL params if present.
        const params = new URLSearchParams(window.location.search);
        const serverParam = params.get('server');
        const gameIdParam = params.get('gameId');
        if (this.gameUrlInput) {
            if (serverParam && gameIdParam) {
                // Compose a game URL from params
                const url = new URL(window.location.href);
                url.searchParams.set('server', serverParam);
                url.searchParams.set('gameId', gameIdParam);
                this.gameUrlInput.value = url.toString();
            } else if (serverParam) {
                const url = new URL(window.location.href);
                url.searchParams.set('server', serverParam);
                this.gameUrlInput.value = url.toString();
            }
        }

        this.multiplayerCreateButton?.addEventListener('click', () => {
            // For create, just use the default server URL (or from the gameUrlInput if present)
            let serverUrl = DEFAULT_SERVER_URL;
            if (this.gameUrlInput && this.gameUrlInput.value.trim()) {
                try {
                    const url = new URL(this.gameUrlInput.value.trim());
                    const params = new URLSearchParams(url.search);
                    serverUrl = params.get('server') || serverUrl;
                } catch (e) {
                    // ignore parse error, fallback to default
                }
            }
            this.showCreateSpinner(true);
            callbacks.onLobbyChoice({ action: 'create', serverUrl });
        });

        this.createCancelButton?.addEventListener('click', () => {
            this.showCreateSpinner(false);
            // Instead of this.showWelcome(), simulate a click on the welcome start button or reload the page, or emit a callback if needed.
            if (this.welcomeBox) this.welcomeBox.style.display = '';
            if (this.gameUi) this.gameUi.style.display = 'none';
            if (this.shareBox) this.shareBox.style.display = 'none';
            if (this.lobbyStatus) this.lobbyStatus.textContent = '';
        });
        this.multiplayerJoinButton?.addEventListener('click', () => {
            if (!this.gameUrlInput || !this.gameUrlInput.value.trim()) {
                this.setLobbyError('Please enter a Game URL to join.');
                return;
            }
            let serverUrl = '';
            let gameId = '';
            try {
                const url = new URL(this.gameUrlInput.value.trim());
                const params = new URLSearchParams(url.search);
                serverUrl = params.get('server') || '';
                gameId = params.get('gameId') || '';
            } catch (e) {
                this.setLobbyError('Invalid Game URL.');
                return;
            }
            if (!serverUrl) {
                this.setLobbyError('Game URL is missing the server parameter.');
                return;
            }
            if (!gameId) {
                this.setLobbyError('Game URL is missing the gameId parameter.');
                return;
            }
            callbacks.onLobbyChoice({ action: 'join', serverUrl, gameId });
        });
        this.multiplayerJoinButton?.addEventListener('click', () => {
            if (!this.gameUrlInput || !this.gameUrlInput.value.trim()) {
                this.setLobbyError('Please enter a Game URL to join.');
                return;
            }
            let serverUrl = '';
            let gameId = '';
            try {
                const url = new URL(this.gameUrlInput.value.trim());
                const params = new URLSearchParams(url.search);
                serverUrl = params.get('server') || '';
                gameId = params.get('gameId') || '';
            } catch (e) {
                this.setLobbyError('Invalid Game URL.');
                return;
            }
            if (!serverUrl) {
                this.setLobbyError('Game URL is missing the server parameter.');
                return;
            }
            if (!gameId) {
                this.setLobbyError('Game URL is missing the gameId parameter.');
                return;
            }
            callbacks.onLobbyChoice({ action: 'join', serverUrl, gameId });
        });
        this.shareCloseButton?.addEventListener('click', () => {
            if (this.shareBox) this.shareBox.style.display = 'none';
        });
    }

    public showCreateSpinner(show: boolean): void {
        if (this.createSpinner) this.createSpinner.style.display = show ? 'flex' : 'none';
        if (this.multiplayerCreateButton) this.multiplayerCreateButton.disabled = show;
        if (this.multiplayerJoinButton) this.multiplayerJoinButton.disabled = show;
        if (this.gameUrlInput) this.gameUrlInput.disabled = show;
    }

    setLobbyError(text: string): void {
        if (this.lobbyStatus) {
            this.lobbyStatus.textContent = text;
            this.lobbyStatus.style.color = '#f87171';
        }
    }

    showShareLink(shareUrl: string): void {
        if (this.shareBox) this.shareBox.style.display = '';
        if (this.shareLink) {
            this.shareLink.href = shareUrl;
            this.shareLink.textContent = shareUrl;
        }
    }
}
