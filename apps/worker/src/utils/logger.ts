/**
 * Logger Utility
 *
 * Centralized logging with structured output for CloudWatch.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    timestamp: string;
    message: string;
    context?: string;
    data?: Record<string, unknown>;
}

class Logger {
    private context: string;

    constructor(context: string = 'Worker') {
        this.context = context;
    }

    private formatMessage(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
        const entry: LogEntry = {
            level,
            timestamp: new Date().toISOString(),
            message: msg,
            context: this.context,
        };

        if (data) {
            entry.data = data;
        }

        // For CloudWatch, structured JSON is preferred
        // But for local dev, readable format is better
        if (process.env.NODE_ENV === 'production') {
            return JSON.stringify(entry);
        }

        const prefix = `[${level.toUpperCase()}] ${entry.timestamp} [${this.context}]`;
        if (data) {
            return `${prefix} ${msg} ${JSON.stringify(data)}`;
        }
        return `${prefix} ${msg}`;
    }

    debug(msg: string, data?: Record<string, unknown>): void {
        if (process.env.LOG_LEVEL === 'debug') {
            console.debug(this.formatMessage('debug', msg, data));
        }
    }

    info(msg: string, data?: Record<string, unknown>): void {
        console.log(this.formatMessage('info', msg, data));
    }

    warn(msg: string, data?: Record<string, unknown>): void {
        console.warn(this.formatMessage('warn', msg, data));
    }

    error(msg: string, error?: Error | unknown, data?: Record<string, unknown>): void {
        const errorData: Record<string, unknown> = { ...data };
        if (error instanceof Error) {
            errorData.errorName = error.name;
            errorData.errorMessage = error.message;
            errorData.stack = error.stack;
        } else if (error) {
            errorData.error = String(error);
        }
        console.error(this.formatMessage('error', msg, errorData));
    }

    /**
     * Create a child logger with a specific context
     */
    child(context: string): Logger {
        return new Logger(`${this.context}:${context}`);
    }
}

// Default logger instance
export const logger = new Logger('Worker');

// Factory function for creating contextual loggers
export function createLogger(context: string): Logger {
    return new Logger(context);
}
