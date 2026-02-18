export enum GameScreen {
  MENU = 'MENU',
  JOINING = 'JOINING',
  LOBBY = 'LOBBY',
  LOADING = 'LOADING',
  PLAYING = 'PLAYING',
  LEADERBOARD = 'LEADERBOARD',
}

export enum Theme {
  ANIMALS = 'Animals',
  COUNTRIES = 'Countries',
  FOOD = 'Food',
  JOBS = 'Jobs',
  SPORTS = 'Sports',
}

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  avatarColor: string;
}

export interface LevelData {
  validWords: string[];
  theme: string;
}

export interface RoomSettings {
  timeLimitMinutes: number; // 5, 10, 15...
  maxPlayers: number; // 2 to 30
  theme: Theme;
  wordCount: number; // 5 to 50
}

// The shared state of the game room
export interface GameState {
  roomCode: string;
  status: 'LOBBY' | 'PLAYING' | 'ENDED';
  players: Player[];
  settings: RoomSettings;
  levelData: LevelData | null;
  foundWords: string[]; // List of words found by ANY player
  startTime: number | null; // Unix timestamp
  winnerId?: string;
}