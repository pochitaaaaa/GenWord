import React, { useState, useEffect, useRef } from 'react';
import { GameScreen, Theme, Player, RoomSettings, GameState } from './types';
import { generateLevel } from './services/geminiService';
import { multiplayerService } from './services/multiplayer';
import { Button } from './components/Button';
import { GameInput } from './components/GameInput';
import { JoinModal } from './components/JoinModal';
import { InfoModal } from './components/InfoModal';

const AVATAR_COLORS = ['#E52521', '#43B047', '#009DDC', '#FBD000', '#9B4F96', '#E66E25'];

const App: React.FC = () => {
  // --- Local State (User Settings) ---
  const [currentPlayer, setCurrentPlayer] = useState<Player>({
    id: 'p_' + Math.floor(Math.random() * 100000), 
    name: 'PLAYER',
    score: 0,
    isHost: false,
    avatarColor: AVATAR_COLORS[0]
  });

  // --- Shared State (Room) ---
  const [gameState, setGameState] = useState<GameState | null>(null);
  
  // --- UI State ---
  const [screen, setScreen] = useState<GameScreen>(GameScreen.MENU);
  const [gameMessage, setGameMessage] = useState<string>("");
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [joinCode, setJoinCode] = useState(""); // For auto-fill from URL
  const [isLoading, setIsLoading] = useState(false);
  
  const [gameMode, setGameMode] = useState<'SINGLE' | 'MULTI'>('MULTI');
  const [timeLeft, setTimeLeft] = useState(0);

  // --- Check URL for Room Code on Load ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
        setJoinCode(roomParam);
        setShowJoinModal(true);
    }
  }, []);

  // --- Prevent Accidental Refresh ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (screen !== GameScreen.MENU && screen !== GameScreen.LEADERBOARD) {
            e.preventDefault();
            e.returnValue = ''; 
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [screen]);


  // --- Multiplayer Subscription ---
  useEffect(() => {
    multiplayerService.subscribe((newState) => {
        if (gameMode === 'SINGLE') return;
        setGameState(newState);
        
        if (newState.status === 'PLAYING' && screen !== GameScreen.PLAYING) {
            setScreen(GameScreen.PLAYING);
        }
        
        // REMOVED: Automatic transition to LEADERBOARD. 
        // We now stay on PLAYING screen to show answers, then user clicks button.
    });
  }, [screen, gameMode]);

  // --- Timer Logic ---
  useEffect(() => {
    if (gameState?.status === 'PLAYING' && gameState.startTime) {
        const interval = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - gameState.startTime!) / 1000);
            const totalSeconds = gameState.settings.timeLimitMinutes * 60;
            const remaining = totalSeconds - elapsedSeconds;

            if (remaining <= 0) {
                setTimeLeft(0);
                if (gameState.status !== 'ENDED') {
                     if (gameMode === 'SINGLE') {
                        // Just update status, do NOT switch screen yet
                        setGameState(prev => prev ? ({...prev, status: 'ENDED'}) : null);
                     } else if (currentPlayer.isHost) {
                        multiplayerService.updateRoom({ status: 'ENDED' });
                     }
                }
            } else {
                setTimeLeft(remaining);
            }
        }, 1000);
        return () => clearInterval(interval);
    } else if (gameState?.status === 'ENDED') {
        setTimeLeft(0);
    }
  }, [gameState?.status, gameState?.startTime, currentPlayer.isHost, gameMode]);


  // --- Actions ---

  const handleStartSinglePlayer = () => {
    setGameMode('SINGLE');
    
    // Default settings for single player
    const settings: RoomSettings = {
        timeLimitMinutes: 5,
        maxPlayers: 1,
        theme: Theme.ANIMALS,
        wordCount: 25
    };

    // Update current player to be host so they can edit settings
    const hostPlayer = { ...currentPlayer, isHost: true, score: 0 };
    setCurrentPlayer(hostPlayer);

    // Initialize Lobby State locally
    const singlePlayerState: GameState = {
        roomCode: 'SOLO',
        status: 'LOBBY',
        players: [hostPlayer],
        settings,
        levelData: null,
        foundWords: [],
        startTime: null
    };
    
    setGameState(singlePlayerState);
    setScreen(GameScreen.LOBBY);
  };

  const handleCreateRoom = async () => {
    setGameMode('MULTI');
    setIsLoading(true);
    
    const settings: RoomSettings = {
        timeLimitMinutes: 5,
        maxPlayers: 30,
        theme: Theme.ANIMALS,
        wordCount: 25
    };
    const hostPlayer = { ...currentPlayer, isHost: true, score: 0 };
    setCurrentPlayer(hostPlayer);
    
    try {
        const newState = await multiplayerService.createRoom(hostPlayer, settings);
        setGameState(newState);
        setScreen(GameScreen.LOBBY);
    } catch (err: any) {
        alert("Failed: " + err);
    } finally {
        setIsLoading(false);
    }
  };

  const handleJoinRoom = async (code: string) => {
    setGameMode('MULTI');
    const cleanCode = code.trim();
    if (cleanCode.length !== 4) {
        alert("Code must be 4 digits.");
        return;
    }

    setIsLoading(true);
    const guestPlayer = { ...currentPlayer, isHost: false, score: 0 };
    setCurrentPlayer(guestPlayer);

    try {
        const initialState = await multiplayerService.joinRoom(cleanCode, guestPlayer);
        setGameState(initialState);
        setShowJoinModal(false);
        setScreen(GameScreen.LOBBY);
        
        // Clear URL params after successful join so refresh doesn't auto-join again weirdly
        window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err: any) {
        alert(err);
    } finally {
        setIsLoading(false);
    }
  };

  const handleUpdateSettings = (newSettings: Partial<RoomSettings>) => {
      if (!gameState || !currentPlayer.isHost) return;
      const updatedSettings = { ...gameState.settings, ...newSettings };
      
      if (gameMode === 'MULTI') {
          multiplayerService.updateSettings(updatedSettings);
      } else {
          // Update local state for single player
          setGameState({
              ...gameState,
              settings: updatedSettings
          });
      }
  };

  const handleStartGame = async () => {
      if (!gameState || !currentPlayer.isHost) return;
      setScreen(GameScreen.LOADING); 
      
      try {
          const levelData = await generateLevel(gameState.settings.theme, gameState.settings.wordCount);
          const startData: Partial<GameState> = {
              status: 'PLAYING',
              levelData: levelData,
              startTime: Date.now(),
              foundWords: []
          };
          
          if (gameMode === 'MULTI') {
             multiplayerService.updateRoom(startData);
          } else {
             setGameState(prev => prev ? ({ ...prev, ...startData }) as GameState : null);
             setScreen(GameScreen.PLAYING);
          }
      } catch (e) {
          setScreen(GameScreen.LOBBY);
      }
  };

  const handleWordSubmit = (word: string) => {
    if (!gameState || !gameState.levelData) return;
    if (gameState.status === 'ENDED') return; // No submit after end

    if (gameState.foundWords.includes(word)) {
        showGameMessage("ALREADY FOUND!");
        return;
    }

    if (gameState.levelData.validWords.includes(word)) {
        const scoreToAdd = 100;
        showGameMessage("EXCELLENT! +100");
        if (gameMode === 'MULTI') {
             multiplayerService.submitWordFound(gameState.roomCode, currentPlayer.id, word, scoreToAdd);
        } else {
             setGameState(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    foundWords: [...prev.foundWords, word],
                    players: prev.players.map(p => p.id === currentPlayer.id ? {...p, score: p.score + scoreToAdd} : p)
                };
            });
        }
    } else {
        showGameMessage("MISS!");
    }
  };

  const showGameMessage = (msg: string) => {
    setGameMessage(msg);
    setTimeout(() => setGameMessage(""), 1500);
  };

  const formatTime = (seconds: number) => {
    if (seconds < 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const copyInviteLink = () => {
    if (!gameState) return;
    const url = `${window.location.origin}?room=${gameState.roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
        alert("Link copied! Share it with friends.");
    }).catch(() => {
        alert("Could not copy link. Manually share: " + url);
    });
  };

  // --- Renderers ---

  const renderMenu = () => (
    <div className="h-full flex flex-col items-center justify-center relative z-10 p-4 mario-pattern">
       <div className="mb-8 transform hover:scale-105 transition-transform duration-300">
        <h1 className="font-retro text-5xl md:text-8xl text-black md:text-[#FBD000] text-shadow-none md:text-shadow-lg text-center tracking-tighter" 
            style={{ textShadow: '4px 4px 0px #fff' }}>
          GENWORD
        </h1>
        <p className="font-vt323 text-2xl md:text-3xl text-black md:text-white text-center mt-2 bg-white md:bg-black inline-block px-4 py-1 -skew-x-12 mx-auto block border-2 border-black">
          ONLINE WORD BATTLE
        </p>
      </div>

      <div className="bg-white p-1 border-4 border-black shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] max-w-md w-full">
        <div className="border-4 border-black p-6 flex flex-col gap-4 bg-[#f8f9fa]">
          <div>
            <label className="font-retro text-xs mb-2 block text-black">PLAYER NAME</label>
            <input 
              type="text" 
              value={currentPlayer.name}
              onChange={(e) => setCurrentPlayer({...currentPlayer, name: e.target.value.toUpperCase()})}
              className="w-full font-vt323 text-3xl border-b-4 border-black bg-transparent outline-none py-1 focus:border-[#E52521] uppercase text-black"
              maxLength={12}
            />
          </div>
          
          <div className="flex gap-2 justify-center my-2">
            {AVATAR_COLORS.map(c => (
              <div 
                key={c}
                onClick={() => setCurrentPlayer({...currentPlayer, avatarColor: c})}
                className={`w-8 h-8 cursor-pointer border-2 border-black transition-transform hover:scale-110 ${currentPlayer.avatarColor === c ? 'ring-4 ring-black' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 mt-4">
             <Button label="PLAY SOLO" variant="primary" onClick={handleStartSinglePlayer} className="w-full py-4 text-xl" />
             <div className="flex gap-2">
                <Button label={isLoading ? "..." : "HOST"} variant="secondary" onClick={handleCreateRoom} disabled={isLoading} className="flex-1 text-xs md:text-sm" />
                <Button label="JOIN" variant="warning" onClick={() => setShowJoinModal(true)} disabled={isLoading} className="flex-1 text-xs md:text-sm" />
             </div>
             <button 
                onClick={() => setShowInfoModal(true)}
                className="font-vt323 text-lg text-black hover:text-[#E52521] underline decoration-dotted"
             >
                HOW IT WORKS? 🧠
             </button>
          </div>
        </div>
      </div>
      
      {showJoinModal && (
          <JoinModal 
            onJoin={handleJoinRoom} 
            onCancel={() => setShowJoinModal(false)} 
            isLoading={isLoading} 
            initialCode={joinCode}
          />
      )}

      {showInfoModal && (
          <InfoModal onClose={() => setShowInfoModal(false)} />
      )}
    </div>
  );

  const renderLobby = () => {
    if (!gameState) return null;

    return (
      <div className="h-full flex flex-col bg-[#5c94fc] mario-pattern">
        
        {/* Header - Red */}
        <div className="bg-[#E52521] border-b-4 border-black p-3 md:p-4 flex justify-between items-center text-white font-retro shadow-md shrink-0">
          <div className="flex items-center gap-4 md:gap-8">
             <div className="flex flex-col">
                <span className="text-[10px] md:text-xs opacity-90">ROOM CODE</span>
                <span className="text-3xl md:text-5xl leading-none">{gameState.roomCode}</span>
             </div>
             {gameMode === 'MULTI' && (
                <button 
                  onClick={copyInviteLink} 
                  className="hidden md:flex bg-white text-black font-vt323 px-3 py-1 border-2 border-black items-center gap-2 hover:bg-gray-200 active:scale-95 shadow-[2px_2px_0_0_#000]"
                >
                   <span className="text-lg">🔗 COPY LINK</span>
                </button>
             )}
          </div>
          
          <div className="flex flex-col items-end">
             <div className="bg-black text-white px-3 py-1 text-xs mb-1 font-retro tracking-widest">WAITING...</div>
             {currentPlayer.isHost && gameMode === 'MULTI' && (
                 <span className="text-[10px] text-yellow-300 animate-pulse">⚠ DO NOT REFRESH</span>
             )}
          </div>
        </div>

        {/* Main Content Split View */}
        <div className="flex-1 flex flex-col md:flex-row p-2 md:p-4 gap-4 overflow-hidden max-w-7xl mx-auto w-full">
            
            {/* Left Column: SETTINGS (White) */}
            <div className="w-full md:w-[350px] bg-white border-4 border-black p-4 flex flex-col gap-6 shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] shrink-0 overflow-y-auto">
                <h2 className="font-retro text-lg border-b-4 border-black pb-2 text-black">SETTINGS</h2>
                
                {/* Theme Selector */}
                <div>
                   <h3 className="font-vt323 text-xl mb-2 text-black font-bold">THEME</h3>
                   <div className="grid grid-cols-2 gap-2">
                      {Object.values(Theme).map(t => {
                          const isSelected = gameState.settings.theme === t;
                          return (
                              <button 
                                key={t}
                                disabled={!currentPlayer.isHost}
                                onClick={() => handleUpdateSettings({ theme: t })}
                                className={`
                                    font-retro text-[10px] md:text-xs py-3 px-2 border-2 border-black transition-all text-center
                                    ${isSelected 
                                        ? 'bg-[#FBD000] text-black shadow-[2px_2px_0_0_#000] translate-x-[1px] translate-y-[1px]' 
                                        : 'bg-white text-gray-800 hover:bg-gray-100'}
                                    ${!currentPlayer.isHost ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                              >
                                {t}
                              </button>
                          );
                      })}
                   </div>
                </div>

                {/* Word Count Selector */}
                <div>
                   <h3 className="font-vt323 text-xl mb-2 text-black font-bold">WORD COUNT</h3>
                   <div className="grid grid-cols-5 gap-2">
                      {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(c => {
                          const isSelected = gameState.settings.wordCount === c;
                          return (
                              <button 
                                key={c}
                                disabled={!currentPlayer.isHost}
                                onClick={() => handleUpdateSettings({ wordCount: c })}
                                className={`
                                    font-retro text-[10px] py-2 border-2 border-black transition-all text-center
                                    ${isSelected 
                                        ? 'bg-[#FBD000] text-black shadow-[2px_2px_0_0_#000] translate-x-[1px] translate-y-[1px]' 
                                        : 'bg-white text-gray-800 hover:bg-gray-100'}
                                     ${!currentPlayer.isHost ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                              >
                                {c}
                              </button>
                          );
                      })}
                   </div>
                </div>

                {/* Time Limit Selector */}
                <div>
                   <h3 className="font-vt323 text-xl mb-2 text-black font-bold">TIME LIMIT</h3>
                   <div className="grid grid-cols-3 gap-2">
                      {[5, 10, 15, 20, 25, 30].map(m => {
                          const isSelected = gameState.settings.timeLimitMinutes === m;
                          return (
                              <button 
                                key={m}
                                disabled={!currentPlayer.isHost}
                                onClick={() => handleUpdateSettings({ timeLimitMinutes: m })}
                                className={`
                                    font-retro text-xs py-2 border-2 border-black transition-all text-center
                                    ${isSelected 
                                        ? 'bg-[#FBD000] text-black shadow-[2px_2px_0_0_#000] translate-x-[1px] translate-y-[1px]' 
                                        : 'bg-white text-gray-800 hover:bg-gray-100'}
                                     ${!currentPlayer.isHost ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                              >
                                {m}m
                              </button>
                          );
                      })}
                   </div>
                </div>
            </div>

            {/* Right Column: PLAYERS (Black) */}
            <div className="flex-1 bg-black border-4 border-black p-4 flex flex-col shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] min-h-[300px]">
               <h2 className="font-retro text-[#43B047] text-sm md:text-base mb-4 tracking-wider">
                  PLAYERS ({gameState.players.length}/{gameState.settings.maxPlayers})
               </h2>
               
               <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto pr-2 custom-scrollbar">
                  {gameState.players.map((p) => (
                      <div key={p.id} className="border-2 border-white p-2 flex flex-col gap-2 relative bg-[#111] min-h-[80px]">
                          <div className="flex items-center gap-2">
                             <div className="w-8 h-8 border border-white shrink-0" style={{backgroundColor: p.avatarColor}}></div>
                             <div className="flex flex-col min-w-0">
                                <span className="font-retro text-[10px] text-white truncate">{p.name}</span>
                                {p.isHost && <span className="font-retro text-[8px] text-[#E52521]">HOST</span>}
                             </div>
                          </div>
                      </div>
                  ))}
                  
                  {/* Empty Slots visualization */}
                  {[...Array(Math.max(0, 12 - gameState.players.length))].map((_, i) => (
                      <div key={i} className="border-2 border-dashed border-gray-700 p-2 flex items-center justify-center min-h-[80px] opacity-50">
                          <span className="font-vt323 text-gray-500 text-sm">EMPTY</span>
                      </div>
                  ))}
               </div>
            </div>
        </div>

        {/* Footer */}
        <div className="bg-white border-t-4 border-black p-4 flex justify-end gap-4 shrink-0 shadow-lg relative z-20">
            <Button 
                label="LEAVE" 
                variant="secondary" 
                onClick={() => {
                  multiplayerService.disconnect();
                  setScreen(GameScreen.MENU);
                }}
                className="w-32"
            />
            {currentPlayer.isHost ? (
                <Button 
                    label="START GAME" 
                    variant="start" 
                    onClick={handleStartGame} 
                    className="w-48 bg-[#E52521] text-white hover:bg-red-600"
                />
            ) : (
                <div className="px-8 py-3 font-retro text-black border-4 border-black bg-gray-200 flex items-center">
                    WAITING FOR HOST...
                </div>
            )}
        </div>

      </div>
    );
  };

  const renderGame = () => {
    if (!gameState || !gameState.levelData) return null;
    const myScore = gameState.players.find(p => p.id === currentPlayer.id)?.score || 0;
    const isGameEnded = gameState.status === 'ENDED';

    return (
      <div className="h-full flex flex-col p-2 md:p-4 gap-4 relative">
        <div className="flex justify-between items-center bg-black border-4 border-white p-2 md:p-4 text-white shadow-lg">
           <div className="flex flex-col">
              <span className="font-retro text-[10px] md:text-xs text-[#E52521]">SCORE</span>
              <span className="font-vt323 text-3xl">{myScore.toString().padStart(6, '0')}</span>
           </div>
           
           <div className="flex flex-col items-center">
              <div className="bg-[#FBD000] text-black px-4 py-1 font-retro text-xs border-2 border-black">
                 {gameState.levelData.theme}
              </div>
              <div className="font-vt323 text-2xl mt-1 text-gray-300">
                 {gameState.foundWords.length} / {gameState.levelData.validWords.length} FOUND
              </div>
           </div>

           <div className="flex flex-col items-end">
              <span className="font-retro text-[10px] md:text-xs text-[#E52521]">TIME</span>
              {isGameEnded ? (
                   <span className="font-retro text-[#E52521] text-xl animate-pulse">TIME UP</span>
              ) : (
                  <span className={`font-vt323 text-3xl ${timeLeft < 10 ? 'text-red-500 animate-pulse' : ''}`}>
                      {formatTime(timeLeft)}
                  </span>
              )}
           </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
            <div className="flex-[2] bg-white border-4 border-black shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] p-4 overflow-y-auto relative">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {gameState.levelData.validWords.map((word, i) => {
                        const isFound = gameState.foundWords.includes(word);
                        const revealMissed = isGameEnded && !isFound;
                        
                        let bgColor = 'bg-[#ddd]';
                        let textColor = 'text-transparent';
                        let shadow = '';
                        let transform = '';
                        
                        if (isFound) {
                            bgColor = 'bg-[#43B047]'; // Green
                            textColor = 'text-white';
                            shadow = 'shadow-[2px_2px_0_0_#000]';
                            transform = '-translate-y-1';
                        } else if (revealMissed) {
                            bgColor = 'bg-[#E52521]'; // Red for missed
                            textColor = 'text-white';
                            shadow = 'shadow-[2px_2px_0_0_#000]';
                            transform = 'opacity-80 scale-95';
                        }

                        return (
                            <div 
                                key={i} 
                                className={`h-12 border-2 border-black flex items-center justify-center font-vt323 text-2xl transition-all ${bgColor} ${textColor} ${shadow} ${transform}`}
                            >
                                {isFound || revealMissed ? word : '?????'}
                            </div>
                        );
                    })}
                </div>
                {gameMessage && !isGameEnded && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black text-[#FBD000] border-4 border-white px-8 py-4 font-retro text-lg animate-bounce z-20 whitespace-nowrap">
                    {gameMessage}
                  </div>
                )}
            </div>

            {gameMode === 'MULTI' && (
                <div className="hidden md:flex flex-col flex-1 bg-black border-4 border-white p-4 overflow-y-auto">
                <h3 className="font-retro text-xs text-center text-white border-b-2 border-gray-700 pb-2 mb-2">LIVE RANKING</h3>
                {[...gameState.players].sort((a,b) => b.score - a.score).map((p) => (
                    <div key={p.id} className={`flex items-center gap-2 mb-2 p-2 border ${p.id === currentPlayer.id ? 'border-[#FBD000] bg-[#333]' : 'border-gray-600 bg-[#222]'}`}>
                        <div className="w-6 h-6 border border-white" style={{backgroundColor: p.avatarColor}}></div>
                        <span className="font-vt323 text-white text-xl flex-1 truncate">{p.name}</span>
                        <span className="font-vt323 text-[#FBD000] text-xl">{p.score}</span>
                    </div>
                ))}
                </div>
            )}
        </div>

        <div className="mt-auto">
            {isGameEnded ? (
                <div className="w-full flex justify-center p-4">
                    <Button 
                        label="VIEW LEADERBOARD >" 
                        variant="warning" 
                        onClick={() => setScreen(GameScreen.LEADERBOARD)}
                        className="w-full max-w-sm py-4 text-xl animate-bounce"
                    />
                </div>
            ) : (
                <GameInput 
                    onWordSubmit={handleWordSubmit} 
                    disabled={timeLeft <= 0}
                />
            )}
        </div>
      </div>
    );
  };

  const renderLeaderboard = () => {
      if (!gameState) return null;
      const sortedPlayers = [...gameState.players].sort((a,b) => b.score - a.score);

      return (
        <div className="h-full flex flex-col items-center justify-center mario-pattern p-4">
            <div className="bg-[#E52521] border-4 border-black p-8 shadow-[12px_12px_0_0_#000] text-center max-w-lg w-full">
                <h2 className="font-retro text-3xl text-[#FBD000] mb-8 text-shadow-lg">GAME OVER!</h2>
                
                <div className="flex flex-col gap-4 mb-8">
                    {sortedPlayers.map((p, index) => (
                        <div key={p.id} className={`flex items-center gap-4 bg-black p-4 border-4 ${index === 0 ? 'border-[#FBD000] transform scale-110 z-10' : 'border-white'}`}>
                            <span className="font-retro text-white text-lg">#{index + 1}</span>
                            <div className="w-8 h-8 border-2 border-white" style={{backgroundColor: p.avatarColor}}></div>
                            <span className="font-vt323 text-white text-2xl flex-1 text-left">{p.name}</span>
                            <span className="font-retro text-[#FBD000] text-xl">{p.score}</span>
                        </div>
                    ))}
                </div>

                <div className="space-y-4">
                    <Button label="EXIT TO MENU" variant="secondary" onClick={() => {
                        multiplayerService.disconnect();
                        setScreen(GameScreen.MENU);
                        window.history.replaceState({}, document.title, window.location.pathname);
                    }} className="w-full" />
                </div>
            </div>
        </div>
      );
  };

  return (
    <div className="h-screen w-full relative overflow-hidden">
        {screen === GameScreen.MENU && renderMenu()}
        {screen === GameScreen.LOBBY && renderLobby()}
        {screen === GameScreen.LOADING && (
             <div className="h-full flex flex-col items-center justify-center bg-black text-white">
                <div className="font-retro text-[#FBD000] text-xl animate-pulse mb-4">GENERATING LEVEL...</div>
                <div className="w-64 h-8 border-4 border-white p-1">
                   <div className="h-full bg-[#E52521] animate-[width_2s_ease-in-out_infinite]" style={{width: '100%'}}></div>
                </div>
             </div>
        )}
        {screen === GameScreen.PLAYING && renderGame()}
        {screen === GameScreen.LEADERBOARD && renderLeaderboard()}
    </div>
  );
};

export default App;