'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Deterministic linear memory manager for Azure voice sessions.
 * Accumulates conversation context so each response builds on prior turns.
 *
 * L1 = rollingTurns (max 30 most recent turns)
 * L2 = runningSummary (updated every 3 finalized user turns)
 * L3 = factLedger (entities, actions, decisions, questions — max 50)
 */
class SessionContextManager {
    constructor() {
        this.sessionId = null;
        this.rollingTurns = [];
        this.runningSummary = '';
        this.factLedger = [];
        this.questionLog = [];
        this.partialTranscript = '';
        this.finalizedUserTurnCount = 0;
    }

    // ─── Public API ─────────────────────────────────────────────────────

    startSession(sessionId) {
        this.reset();
        this.sessionId = sessionId;
    }

    appendPartialTranscript(text) {
        this.partialTranscript = text || '';
    }

    finalizeUserTurn(text) {
        if (!text || !text.trim()) return;

        const trimmed = text.trim();
        const turn = {
            role: 'user',
            text: trimmed,
            timestamp: Date.now(),
            isQuestion: this.isQuestion(trimmed)
        };

        this.rollingTurns.push(turn);
        if (this.rollingTurns.length > 30) {
            this.rollingTurns.shift();
        }

        this.partialTranscript = '';
        this.finalizedUserTurnCount++;

        // L3: extract facts
        this._extractFacts(trimmed, turn.isQuestion);

        // L2: update summary every 3 finalized user turns
        if (this.finalizedUserTurnCount % 3 === 0) {
            this._updateSummary();
        }
    }

    appendAssistantTurn(text) {
        if (!text || !text.trim()) return;

        const turn = {
            role: 'assistant',
            text: text.trim(),
            timestamp: Date.now(),
            isQuestion: false
        };

        this.rollingTurns.push(turn);
        if (this.rollingTurns.length > 30) {
            this.rollingTurns.shift();
        }
    }

    getPromptContext() {
        const parts = [];

        if (this.runningSummary) {
            parts.push(this.runningSummary);
        }

        // Recent turns (last 6)
        const recentTurns = this.rollingTurns.slice(-6);
        if (recentTurns.length > 0) {
            const turnLines = recentTurns.map(t => {
                const prefix = t.role === 'user' ? 'User' : 'Assistant';
                // Truncate long turns to keep context compact
                const snippet = t.text.length > 150 ? t.text.slice(0, 147) + '...' : t.text;
                return `${prefix}: ${snippet}`;
            });
            parts.push('Recent:\n' + turnLines.join('\n'));
        }

        // Key facts from ledger (last 10)
        const recentFacts = this.factLedger.slice(-10);
        if (recentFacts.length > 0) {
            const factLines = recentFacts.map(f => `[${f.type}] ${f.text}`);
            parts.push('Key facts: ' + factLines.join('; '));
        }

        let result = parts.join('\n\n');
        if (result.length > 1500) {
            result = result.slice(0, 1497) + '...';
        }
        return result;
    }

    isQuestion(text) {
        if (!text) return false;
        const trimmed = text.trim();

        // Ends with question mark
        if (trimmed.endsWith('?')) return true;

        // Interrogative pattern: starts with who/what/when/where/why/how
        // followed by a verb-like word within first 4 words
        const words = trimmed.toLowerCase().split(/\s+/).slice(0, 4);
        const interrogatives = ['who', 'what', 'when', 'where', 'why', 'how'];

        if (words.length >= 2 && interrogatives.includes(words[0])) {
            // Check if there's a verb-like word (ends with s, ed, ing, or is a common verb)
            const commonVerbs = ['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall', 'has', 'have', 'had'];
            for (let i = 1; i < words.length; i++) {
                const w = words[i];
                if (commonVerbs.includes(w) || w.endsWith('s') || w.endsWith('ed') || w.endsWith('ing')) {
                    return true;
                }
            }
        }

        return false;
    }

    getLastQuestion() {
        if (this.questionLog.length === 0) return null;
        return this.questionLog[this.questionLog.length - 1].text;
    }

    serialize() {
        return {
            sessionId: this.sessionId,
            rollingTurns: this.rollingTurns,
            runningSummary: this.runningSummary,
            factLedger: this.factLedger,
            questionLog: this.questionLog,
            partialTranscript: this.partialTranscript,
            finalizedUserTurnCount: this.finalizedUserTurnCount
        };
    }

    hydrate(payload) {
        if (!payload || typeof payload !== 'object') return;
        this.sessionId = payload.sessionId || null;
        this.rollingTurns = Array.isArray(payload.rollingTurns) ? payload.rollingTurns : [];
        this.runningSummary = payload.runningSummary || '';
        this.factLedger = Array.isArray(payload.factLedger) ? payload.factLedger : [];
        this.questionLog = Array.isArray(payload.questionLog) ? payload.questionLog : [];
        this.partialTranscript = payload.partialTranscript || '';
        this.finalizedUserTurnCount = payload.finalizedUserTurnCount || 0;
    }

    async flushToDisk() {
        if (!this.sessionId) return;

        const dir = this._getConfigDir();
        const filePath = path.join(dir, `session-context-${this.sessionId}.json`);

        try {
            await fs.promises.mkdir(dir, { recursive: true });
            const data = JSON.stringify(this.serialize(), null, 2);
            await fs.promises.writeFile(filePath, data, 'utf8');
        } catch (err) {
            console.error('[SessionContext] Failed to flush to disk:', err.message);
        }
    }

    async hydrateFromDisk(sessionId) {
        const dir = this._getConfigDir();
        const filePath = path.join(dir, `session-context-${sessionId}.json`);

        try {
            const data = await fs.promises.readFile(filePath, 'utf8');
            const payload = JSON.parse(data);
            this.hydrate(payload);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('[SessionContext] Failed to hydrate from disk:', err.message);
            }
            // File doesn't exist — fresh session, nothing to restore
        }
    }

    reset() {
        this.sessionId = null;
        this.rollingTurns = [];
        this.runningSummary = '';
        this.factLedger = [];
        this.questionLog = [];
        this.partialTranscript = '';
        this.finalizedUserTurnCount = 0;
    }

    // ─── Private Helpers ────────────────────────────────────────────────

    _getConfigDir() {
        const platform = process.platform;
        if (platform === 'win32') {
            return path.join(os.homedir(), 'AppData', 'Roaming', 'sound-board-config');
        } else if (platform === 'darwin') {
            return path.join(os.homedir(), 'Library', 'Application Support', 'sound-board-config');
        } else {
            return path.join(os.homedir(), '.config', 'sound-board-config');
        }
    }

    _updateSummary() {
        // Take last 6 turns
        const recent = this.rollingTurns.slice(-6);
        if (recent.length === 0) {
            return;
        }

        // Extract sentences containing named entities or action verbs
        const actionVerbs = ['create', 'build', 'deploy', 'configure', 'set up', 'install', 'migrate', 'update', 'fix', 'implement', 'design', 'plan', 'discuss', 'review', 'analyze'];
        const keyPhrases = [];

        for (const turn of recent) {
            const sentences = turn.text.split(/[.!?]+/).filter(s => s.trim().length > 5);
            for (const sentence of sentences) {
                const trimSentence = sentence.trim();
                // Check for named entities (capitalized words not at sentence start)
                const words = trimSentence.split(/\s+/);
                const hasEntity = words.slice(1).some(w => /^[A-Z][a-z]/.test(w));
                // Check for action verbs
                const lower = trimSentence.toLowerCase();
                const hasAction = actionVerbs.some(v => lower.includes(v));

                if (hasEntity || hasAction) {
                    keyPhrases.push(trimSentence);
                }
            }
        }

        if (keyPhrases.length > 0) {
            let summary = 'Discussion so far: ' + keyPhrases.join('; ');
            if (summary.length > 500) {
                summary = summary.slice(0, 497) + '...';
            }
            this.runningSummary = summary;
        }
    }

    _extractFacts(text, textIsQuestion) {
        const timestamp = Date.now();

        // Questions
        if (textIsQuestion) {
            this.factLedger.push({ type: 'question', text, timestamp });
            this.questionLog.push({ text, timestamp });
        }

        // Decisions
        const decisionPatterns = ['decided', 'agreed', 'will do', "let's go with"];
        const lower = text.toLowerCase();
        if (decisionPatterns.some(p => lower.includes(p))) {
            this.factLedger.push({ type: 'decision', text, timestamp });
        }

        // Actions
        const actionPatterns = ['need to', 'should', 'must', 'action item'];
        if (actionPatterns.some(p => lower.includes(p))) {
            this.factLedger.push({ type: 'action', text, timestamp });
        }

        // Entities: capitalized words that aren't sentence-start
        const sentences = text.split(/\.\s+/);
        for (const sentence of sentences) {
            const words = sentence.trim().split(/\s+/);
            for (let i = 1; i < words.length; i++) {
                const word = words[i].replace(/[^a-zA-Z]/g, '');
                if (word.length > 1 && /^[A-Z][a-z]/.test(word)) {
                    this.factLedger.push({ type: 'entity', text: word, timestamp });
                    break; // One entity per sentence to avoid noise
                }
            }
        }

        // FIFO trim to 50 entries
        while (this.factLedger.length > 50) {
            this.factLedger.shift();
        }
    }
}

module.exports = { SessionContextManager };
