import { GameConfig } from '../GameConfig.js';

export interface DomUiCallbacks {
    onWelcomeStart: () => void;
    onStartRound: () => void;
    onToggleFullscreen: () => void;
}

/** Encapsulates all DOM element wiring outside the Phaser canvas. */
export class DomUi {
    private readonly welcomeBox = document.getElementById('welcome-box');
    private readonly welcomeStartButton = document.getElementById('welcome-start') as HTMLButtonElement | null;
    private readonly gameUi = document.getElementById('ui');
    private readonly statusEl = document.getElementById('status');
    private readonly startButton = document.getElementById('start-round') as HTMLButtonElement | null;
    private readonly fullscreenButton = document.getElementById('fullscreen-button') as HTMLButtonElement | null;

    bind(callbacks: DomUiCallbacks): void {
        this.welcomeStartButton?.addEventListener('click', callbacks.onWelcomeStart);
        this.startButton?.addEventListener('click', callbacks.onStartRound);
        this.fullscreenButton?.addEventListener('click', callbacks.onToggleFullscreen);
    }

    showWelcome(): void {
        if (this.welcomeBox) this.welcomeBox.style.display = '';
        if (this.gameUi) this.gameUi.style.display = 'none';
    }

    showGameUi(): void {
        if (this.welcomeBox) this.welcomeBox.style.display = 'none';
        if (this.gameUi) this.gameUi.style.display = '';
    }

    scheduleWelcomeReplay(delayMs: number = GameConfig.REPLAY_DELAY): void {
        setTimeout(() => this.showWelcome(), delayMs);
    }

    setStatus(text: string): void {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    setStartEnabled(enabled: boolean): void {
        if (this.startButton) this.startButton.disabled = !enabled;
    }

    get isStartEnabled(): boolean {
        return !!this.startButton && !this.startButton.disabled;
    }
}
