import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { ServerManager } from './ServerManager';
import { ErrorHandler } from '../utils/error-handler';
import { ServerStateChangeEvent } from './types';

// Mock child_process.spawn
vi.mock('child_process', () => ({
	spawn: vi.fn(() => ({
		pid: 12345,
		stdout: { on: vi.fn() },
		stderr: { on: vi.fn() },
		on: vi.fn(),
		kill: vi.fn(),
		exitCode: null,
		signalCode: null
	})),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ServerManager', () => {
	let serverManager: ServerManager;
	let errorHandler: ErrorHandler;
	let mockOnStateChange: (event: ServerStateChangeEvent) => void;
	let mockProcess: any;

	const testConfig = {
		opencodePath: 'opencode',
		port: 4096,
		hostname: '127.0.0.1',
		startupTimeout: 5000,
		workingDirectory: 'test/workspace',
	};

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Create mock error handler
		errorHandler = {
			handleError: vi.fn(),
			collectErrors: false,
			showUserNotifications: false,
			logToConsole: false,
			dispose: vi.fn(),
			notificationCallback: vi.fn(),
			wrapAsync: vi.fn(),
			wrapSync: vi.fn(),
			getCollectedErrors: vi.fn(),
			clearCollectedErrors: vi.fn(),
		} as any;

		// Create mock state change handler
		mockOnStateChange = vi.fn();

		// Create mock process
		mockProcess = {
			pid: 12345,
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn() },
			on: vi.fn(),
			kill: vi.fn(),
			exitCode: null,
			signalCode: null
		};

		// Create server manager
		serverManager = new ServerManager(testConfig, errorHandler, mockOnStateChange);
	});

	afterEach(() => {
		// Cleanup
		serverManager.stop();
	});

	describe('initialization', () => {
		it('should initialize with correct configuration', () => {
			expect(serverManager.getState()).toBe('stopped');
			expect(serverManager.getUrl()).toBe('http://127.0.0.1:4096');
		});

		it('should update configuration correctly', () => {
			const newConfig = { port: 8080, hostname: 'localhost' };
			serverManager.updateConfig(newConfig);
			expect(serverManager.getUrl()).toBe('http://localhost:8080');
		});
	});

	describe('server start', () => {
		it('should handle missing working directory', async () => {
			// Create server manager with empty working directory
			const badServerManager = new ServerManager(
				{ ...testConfig, workingDirectory: '' },
				errorHandler,
				mockOnStateChange
			);

			// Start the server
			const result = await badServerManager.start();

			expect(result).toBe(false);
			expect(badServerManager.getState()).toBe('error');
			expect(badServerManager.getLastError()?.message).toBe('Working directory not configured');
		});

		it('should not restart when already running', async () => {
			// Start server first time - will detect server already running (mock fetch succeeds)
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				headers: { get: vi.fn() },
				json: vi.fn().mockResolvedValue({}),
				text: vi.fn().mockResolvedValue(''),
				blob: vi.fn().mockResolvedValue(new Blob()),
				formData: vi.fn().mockResolvedValue(new FormData()),
				redirected: false,
				statusText: 'OK',
				type: 'basic',
				url: '',
				clone: vi.fn(),
				body: null,
				bodyUsed: false,
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
			});

			// Start server first time - will detect server already running
			const result1 = await serverManager.start();
			expect(result1).toBe(true);
			expect(serverManager.getState()).toBe('running');

			// Reset fetch mock
			mockFetch.mockReset();

			// Start server second time - should detect already running and not call spawn
			const result2 = await serverManager.start();
			expect(result2).toBe(true);
			// Should not call spawn when server is already running
			expect(spawn).not.toHaveBeenCalled();
		});
	});

	describe('server stop', () => {
		it('should stop server successfully when not running', () => {
			// Stop the server
			serverManager.stop();

			expect(serverManager.getState()).toBe('stopped');
		});
	});
});
