/* ==========================================================================
   NextMove Predictor - Application Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // --- Game State Variables ---
  const chess = new Chess();
  let boardFlipped = false;
  let selectedSquare = null;
  let moveHistory = [];
  let currentSearchId = 0;
  let fenHistory = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];

  // --- Game Review State ---
  let moveReviews = []; // Array of { san, quality, eval, loss }
  let reviewQueue = [];  // Queue of { preMoveFen, uciMove, sanMove, moveIndex, moveObj }
  let isReviewing = false;
  let activeReviewTask = null;
  let reviewCandidates = [];
  let engineMode = 'idle'; // 'idle', 'predicting', 'reviewing'
  let activeReviewVisual = null;      // Stored { from, to, quality, bestFrom, bestTo }
  let activeSearchSuggestedMove = null; // Stored { from, to }

  // Standard opening sequences for Book Move detection
  const bookOpenings = new Set([
    'e4', 'e4 e5', 'e4 e5 Nf3', 'e4 e5 Nf3 Nc6', 'e4 e5 Nf3 Nc6 Bb5', 'e4 e5 Nf3 Nc6 Bc4',
    'e4 e5 Nf3 Nf6', 'e4 e5 f4', 'e4 c5', 'e4 c5 Nf3', 'e4 c5 Nf3 d6', 'e4 c5 Nf3 Nc6',
    'e4 e6', 'e4 e6 d4', 'e4 e6 d4 d5', 'e4 c6', 'e4 c6 d4', 'e4 c6 d4 d5',
    'd4', 'd4 d5', 'd4 d5 c4', 'd4 d5 c4 e6', 'd4 d5 c4 c6', 'd4 Nf6', 'd4 Nf6 c4',
    'd4 Nf6 c4 e6', 'd4 Nf6 c4 g6', 'Nf3', 'Nf3 d5', 'Nf3 Nf6', 'c4', 'c4 e5', 'c4 c5'
  ]);
  
  // --- DOM Elements ---
  const boardEl = document.getElementById('chess-board');
  const gameStatusEl = document.getElementById('game-status');
  const fenInputEl = document.getElementById('fen-input');
  const fenPreviewTextEl = document.getElementById('fen-preview-text');
  
  const btnCopyPgn = document.getElementById('btn-copy-pgn');
  const btnExportPgn = document.getElementById('btn-export-pgn');
  
  const eloSlider = document.getElementById('elo-slider');
  const eloValEl = document.getElementById('elo-val');
  const accuracySlider = document.getElementById('accuracy-slider');
  const accuracyValEl = document.getElementById('accuracy-val');
  const accuracyClassEl = document.getElementById('accuracy-class');
  
  const btnPredict = document.getElementById('btn-predict');
  const btnPredictText = document.getElementById('btn-predict-text');
  const predictSpinner = document.getElementById('predict-spinner');
  
  const btnFlip = document.getElementById('btn-flip');
  const btnReset = document.getElementById('btn-reset');
  const btnLoadFen = document.getElementById('btn-load-fen');
  const btnCopyFen = document.getElementById('btn-copy-fen');
  
  const resultsPanel = document.getElementById('results-panel');
  const chosenMoveNotationEl = document.getElementById('chosen-move-notation');
  const chosenMoveEvalEl = document.getElementById('chosen-move-eval');
  const chosenMoveQualityEl = document.getElementById('chosen-move-quality');
  const moveExplanationEl = document.getElementById('move-explanation-text');
  const candidatesTbody = document.getElementById('candidates-tbody');
  
  const reviewAccuracyVal = document.getElementById('review-accuracy-val');
  const accuracyDialValue = document.getElementById('accuracy-dial-value');
  const countBrilliant = document.getElementById('count-brilliant');
  const countGreat = document.getElementById('count-great');
  const countBest = document.getElementById('count-best');
  const countExcellent = document.getElementById('count-excellent');
  const countBook = document.getElementById('count-book');
  const countGood = document.getElementById('count-good');
  const countInaccuracy = document.getElementById('count-inaccuracy');
  const countMistake = document.getElementById('count-mistake');
  const countBlunder = document.getElementById('count-blunder');
  
  const movesHistoryEl = document.getElementById('moves-history');
  
  const btnToggleLog = document.getElementById('btn-toggle-log');
  const btnClearLog = document.getElementById('btn-clear-log');
  const engineLogContainer = document.getElementById('engine-log-container');
  const engineLogEl = document.getElementById('engine-log');
  const statusDot = document.getElementById('status-dot');
  const engineStatusText = document.getElementById('engine-status-text');

  // --- SVG Pieces URLs (Wikimedia Commons) ---
  const pieceImages = {
    'p': 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
    'r': 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
    'n': 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
    'b': 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
    'q': 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
    'k': 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
    'P': 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
    'R': 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
    'N': 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
    'B': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
    'Q': 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
    'K': 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg'
  };

  // --- Stockfish Web Worker Integration ---
  let stockfishWorker = null;
  let engineReady = false;
  let activeSearchCandidates = [];
  let uciResponseLog = [];

  function logEngine(msg) {
    uciResponseLog.push(msg);
    if (uciResponseLog.length > 300) uciResponseLog.shift();
    engineLogEl.textContent = uciResponseLog.join('\n');
    engineLogEl.scrollTop = engineLogEl.scrollHeight;
  }

  function initEngine() {
    logEngine("Initializing Stockfish Chess Engine...");
    
    // Check for WebAssembly support
    const wasmSupported = typeof WebAssembly === 'object' && 
                          WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
    
    const workerFile = wasmSupported ? 'stockfish.wasm.js' : 'stockfish.js';
    logEngine(`Loading worker file: ${workerFile} (WASM Supported: ${wasmSupported})`);
    
    try {
      stockfishWorker = new Worker(workerFile);
      
      stockfishWorker.onmessage = (event) => {
        const line = event.data;
        logEngine(`[Engine Out]: ${line}`);
        handleEngineMessage(line);
      };

      stockfishWorker.onerror = (err) => {
        logEngine(`[Engine Error]: ${err.message}`);
        setEngineStatus('error', 'Engine Error');
      };

      // Initialize UCI mode
      sendToEngine('uci');
      sendToEngine('isready');
      setEngineStatus('loading', 'Initializing...');
    } catch (e) {
      logEngine(`Failed to start Web Worker: ${e.message}`);
      setEngineStatus('error', 'Fallback Mode');
    }
  }

  function sendToEngine(cmd) {
    if (stockfishWorker) {
      logEngine(`[Engine In]: ${cmd}`);
      stockfishWorker.postMessage(cmd);
    }
  }

  function setEngineStatus(status, text) {
    statusDot.className = 'status-indicator';
    btnPredict.disabled = true;
    
    if (status === 'online') {
      statusDot.classList.add('online');
      engineStatusText.textContent = text || 'Engine Ready';
      btnPredict.disabled = false;
      btnPredictText.textContent = 'Suggest Best Move';
      engineReady = true;
    } else if (status === 'loading') {
      statusDot.classList.add('loading');
      engineStatusText.textContent = text || 'Loading...';
      btnPredictText.textContent = 'Engine Loading...';
      engineReady = false;
    } else {
      engineStatusText.textContent = text || 'Disconnected';
      btnPredictText.textContent = 'Engine Unavailable';
      engineReady = false;
    }
  }

  // --- UCI Engine Message Parser ---
  function handleEngineMessage(line) {
    if (line === 'readyok') {
      sendToEngine('setoption name MultiPV value 4');
      setEngineStatus('online', 'Engine Ready');
    }
    
    // Parse search info lines
    if (line.startsWith('info') && line.includes('multipv')) {
      if (engineMode === 'predicting') {
        parseMultiPvLine(line);
      } else if (engineMode === 'reviewing') {
        parseReviewMultiPvLine(line);
      }
    }
    
    // Parse bestmove line
    if (line.startsWith('bestmove')) {
      if (engineMode === 'predicting') {
        const parts = line.split(/\s+/);
        const bestMove = parts[1];
        logEngine(`Search finished. Raw Bestmove: ${bestMove}`);
        
        predictSpinner.classList.add('hidden');
        btnPredict.disabled = false;
        btnPredictText.textContent = 'Suggest Best Move';
        engineMode = 'idle';
        
        if (bestMove && bestMove !== '(none)') {
          selectAndDisplaySuggestedMove();
        } else {
          alert("No legal moves available in this position.");
        }
        
        // Resume review queue processing
        processReviewQueue();
      } else if (engineMode === 'reviewing') {
        finalizeMoveReview();
      }
    }
  }

  function parseMultiPvLine(line) {
    const parts = line.split(/\s+/);
    
    const depthIdx = parts.indexOf('depth');
    const multiPvIdx = parts.indexOf('multipv');
    const scoreIdx = parts.indexOf('score');
    const pvIdx = parts.indexOf('pv');
    
    if (multiPvIdx === -1 || pvIdx === -1) return;
    
    const depth = parseInt(parts[depthIdx + 1]);
    const rank = parseInt(parts[multiPvIdx + 1]);
    const nextMoveUci = parts[pvIdx + 1];
    
    let scoreType = parts[scoreIdx + 1]; // 'cp' or 'mate'
    let scoreVal = parseInt(parts[scoreIdx + 2]);
    
    let formattedScore = "";
    if (scoreType === 'cp') {
      const val = (scoreVal / 100).toFixed(2);
      formattedScore = val > 0 ? `+${val}` : `${val}`;
    } else if (scoreType === 'mate') {
      formattedScore = `Mate in ${scoreVal}`;
    }

    const existingIdx = activeSearchCandidates.findIndex(c => c.rank === rank);
    const candidateData = {
      rank: rank,
      uci: nextMoveUci,
      san: convertUciToSan(nextMoveUci),
      eval: formattedScore,
      depth: depth,
      rawScore: scoreType === 'cp' ? scoreVal : (scoreVal > 0 ? 10000 - scoreVal : -10000 - scoreVal)
    };

    if (existingIdx !== -1) {
      if (depth >= activeSearchCandidates[existingIdx].depth) {
        activeSearchCandidates[existingIdx] = candidateData;
      }
    } else {
      activeSearchCandidates.push(candidateData);
    }
  }

  function parseReviewMultiPvLine(line) {
    const parts = line.split(/\s+/);
    
    const depthIdx = parts.indexOf('depth');
    const multiPvIdx = parts.indexOf('multipv');
    const scoreIdx = parts.indexOf('score');
    const pvIdx = parts.indexOf('pv');
    
    if (multiPvIdx === -1 || pvIdx === -1) return;
    
    const depth = parseInt(parts[depthIdx + 1]);
    const rank = parseInt(parts[multiPvIdx + 1]);
    const nextMoveUci = parts[pvIdx + 1];
    
    let scoreType = parts[scoreIdx + 1]; // 'cp' or 'mate'
    let scoreVal = parseInt(parts[scoreIdx + 2]);
    
    let formattedScore = "";
    if (scoreType === 'cp') {
      const val = (scoreVal / 100).toFixed(2);
      formattedScore = val > 0 ? `+${val}` : `${val}`;
    } else if (scoreType === 'mate') {
      formattedScore = `Mate in ${scoreVal}`;
    }

    const existingIdx = reviewCandidates.findIndex(c => c.rank === rank);
    const candidateData = {
      rank: rank,
      uci: nextMoveUci,
      eval: formattedScore,
      depth: depth,
      rawScore: scoreType === 'cp' ? scoreVal : (scoreVal > 0 ? 10000 - scoreVal : -10000 - scoreVal)
    };

    if (existingIdx !== -1) {
      if (depth >= reviewCandidates[existingIdx].depth) {
        reviewCandidates[existingIdx] = candidateData;
      }
    } else {
      reviewCandidates.push(candidateData);
    }
  }

  function finalizeMoveReview() {
    if (reviewCandidates.length === 0) {
      isReviewing = false;
      engineMode = 'idle';
      processReviewQueue();
      return;
    }
    
    reviewCandidates.sort((a, b) => a.rank - b.rank);
    
    const task = activeReviewTask;
    const bestMove = reviewCandidates[0];
    const playedMoveUci = task.uciMove;
    
    const playedCandidate = reviewCandidates.find(c => c.uci === playedMoveUci);
    
    let loss = 0;
    if (playedCandidate) {
      loss = bestMove.rawScore - playedCandidate.rawScore;
    } else {
      loss = 250; // 2.5 pawns loss default for out-of-MultiPV blunder
    }
    
    let quality = 'best';
    
    if (loss <= 10) {
      // Check for sacrifice (Brilliant Move !!)
      const isSacrifice = task.moveObj.captured && 
                          ['n', 'b', 'r', 'q'].includes(task.moveObj.piece) && 
                          task.moveObj.captured === 'p';
      if (isSacrifice && bestMove.rawScore > -100) {
        quality = 'brilliant';
      } 
      // Check for Great Move (!) - only winning move
      else if (reviewCandidates.length >= 2 && (reviewCandidates[0].rawScore - reviewCandidates[1].rawScore) > 150) {
        quality = 'great';
      } else {
        quality = 'best';
      }
    } else if (loss <= 20) {
      quality = 'excellent';
    } else if (loss <= 45) {
      quality = 'good';
    } else if (loss <= 90) {
      quality = 'inaccuracy';
    } else if (loss <= 200) {
      quality = 'mistake';
    } else {
      quality = 'blunder';
    }
    
    moveReviews[task.moveIndex] = {
      san: task.sanMove,
      quality: quality,
      eval: playedCandidate ? playedCandidate.eval : (bestMove.rawScore > 0 ? 'Worse' : 'Losing'),
      loss: loss
    };
    
    logEngine(`[Reviewed Move ${task.moveIndex + 1}]: Result is ${quality.toUpperCase()} (Loss: ${loss} cp)`);
    
    // Draw visual feedback on the board if this is the active live move
    const history = chess.history({ verbose: true });
    if (task.moveIndex === history.length - 1) {
      const isSubOptimal = !['brilliant', 'great', 'best', 'excellent'].includes(quality);
      activeReviewVisual = {
        from: task.moveObj.from,
        to: task.moveObj.to,
        quality: quality,
        bestFrom: isSubOptimal ? bestMove.uci.substring(0, 2) : null,
        bestTo: isSubOptimal ? bestMove.uci.substring(2, 4) : null
      };
      applyReviewVisual(activeReviewVisual);
    }
    
    updateReviewScorecard();
    renderMoveHistory();
    
    isReviewing = false;
    engineMode = 'idle';
    processReviewQueue();
  }

  // Convert raw UCI square coordinates (e.g., e2e4) to Standard Algebraic Notation (SAN) for display
  function convertUciToSan(uci) {
    if (!uci) return '';
    try {
      const from = uci.substring(0, 2);
      const to = uci.substring(2, 4);
      const promotion = uci.length > 4 ? uci.charAt(4) : null;
      
      // Setup a temp game state to find the SAN move
      const tempGame = new Chess(chess.fen());
      const move = tempGame.move({ from: from, to: to, promotion: promotion });
      return move ? move.san : uci;
    } catch (e) {
      return uci;
    }
  }

  function isBookMoveSequence(sequence) {
    const cleanSeq = sequence.replace(/[\+#]/g, '');
    return bookOpenings.has(cleanSeq);
  }

  function getBadgeSymbol(quality) {
    switch (quality) {
      case 'brilliant': return '!!';
      case 'great': return '!';
      case 'best': return '★';
      case 'excellent': return '✔';
      case 'book': return '📖';
      case 'good': return '✓';
      case 'inaccuracy': return '?!';
      case 'mistake': return '?';
      case 'blunder': return '??';
      default: return '';
    }
  }

  function applyReviewVisual(visual) {
    const fromSq = document.querySelector(`.square[data-coord="${visual.from}"]`);
    const toSq = document.querySelector(`.square[data-coord="${visual.to}"]`);
    
    if (fromSq) fromSq.classList.add(`move-${visual.quality}`);
    if (toSq) {
      toSq.classList.add(`move-${visual.quality}`);
      
      const existingBadge = toSq.querySelector('.board-move-badge');
      if (existingBadge) existingBadge.remove();
      
      const badge = document.createElement('div');
      badge.className = `board-move-badge ${visual.quality}`;
      badge.innerHTML = `<span class="badge-icon">${getBadgeSymbol(visual.quality)}</span>`;
      toSq.appendChild(badge);
    }
    
    if (visual.bestFrom && visual.bestTo) {
      drawArrow(visual.bestFrom, visual.bestTo, 'best');
    }
  }

  function getSquareCenterPercent(coord) {
    if (!coord || coord.length < 2) return { x: 0, y: 0 };
    const file = coord.charCodeAt(0) - 97; // 'a' = 0
    const rank = 8 - parseInt(coord.charAt(1)); // '8' = 0
    
    let fIdx = file;
    let rIdx = rank;
    if (boardFlipped) {
      fIdx = 7 - file;
      rIdx = 7 - rank;
    }
    
    const x = (fIdx + 0.5) * 12.5;
    const y = (rIdx + 0.5) * 12.5;
    return { x, y };
  }

  function drawArrow(from, to, type = 'best') {
    const svg = document.getElementById('board-arrows-svg');
    if (!svg) return;
    
    const start = getSquareCenterPercent(from);
    const end = getSquareCenterPercent(to);
    
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    const shortenVal = 5.0; // Pct to shorten
    let targetX = end.x;
    let targetY = end.y;
    
    if (dist > shortenVal) {
      targetX = end.x - (dx / dist) * shortenVal;
      targetY = end.y - (dy / dist) * shortenVal;
    }
    
    const color = type === 'best' ? 'rgba(20, 184, 166, 0.8)' : 'rgba(56, 189, 248, 0.8)';
    const markerId = type === 'best' ? 'arrowhead-best' : 'arrowhead-suggest';
    
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${start.x}%`);
    line.setAttribute("y1", `${start.y}%`);
    line.setAttribute("x2", `${targetX}%`);
    line.setAttribute("y2", `${targetY}%`);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1.6%"); // scaled to board
    line.setAttribute("marker-end", `url(#${markerId})`);
    
    svg.appendChild(line);
  }

  function clearBoardVisuals() {
    activeReviewVisual = null;
    activeSearchSuggestedMove = null;
    
    document.querySelectorAll('.square').forEach(sq => {
      sq.className = sq.className.split(' ').filter(c => !c.startsWith('move-')).join(' ');
      const badge = sq.querySelector('.board-move-badge');
      if (badge) badge.remove();
    });
    
    const svg = document.getElementById('board-arrows-svg');
    if (svg) {
      svg.querySelectorAll('line').forEach(l => l.remove());
    }
  }

  function updateReviewScorecard() {
    const counts = {
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      book: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0
    };
    
    let totalLoss = 0;
    let reviewedCount = 0;
    
    moveReviews.forEach(r => {
      if (r && r.quality !== 'loading') {
        counts[r.quality]++;
        if (r.quality !== 'book') {
          totalLoss += Math.max(0, r.loss);
          reviewedCount++;
        }
      }
    });
    
    if (countBrilliant) countBrilliant.textContent = counts.brilliant;
    if (countGreat) countGreat.textContent = counts.great;
    if (countBest) countBest.textContent = counts.best;
    if (countExcellent) countExcellent.textContent = counts.excellent;
    if (countBook) countBook.textContent = counts.book;
    if (countGood) countGood.textContent = counts.good;
    if (countInaccuracy) countInaccuracy.textContent = counts.inaccuracy;
    if (countMistake) countMistake.textContent = counts.mistake;
    if (countBlunder) countBlunder.textContent = counts.blunder;
    
    let accuracy = 100;
    if (reviewedCount > 0) {
      const avgLoss = totalLoss / reviewedCount;
      accuracy = Math.round(100 * Math.exp(-0.004 * avgLoss));
      accuracy = Math.max(0, Math.min(100, accuracy));
    }
    
    if (reviewAccuracyVal) reviewAccuracyVal.textContent = `${accuracy}%`;
    
    if (accuracyDialValue) {
      const dashoffset = 264 - (264 * accuracy / 100);
      accuracyDialValue.style.strokeDashoffset = dashoffset;
      
      if (accuracy >= 85) {
        accuracyDialValue.style.stroke = 'var(--color-primary)';
      } else if (accuracy >= 70) {
        accuracyDialValue.style.stroke = '#38bdf8';
      } else if (accuracy >= 50) {
        accuracyDialValue.style.stroke = 'var(--color-warning)';
      } else {
        accuracyDialValue.style.stroke = 'var(--color-danger)';
      }
    }
  }

  function processReviewQueue() {
    if (isReviewing || reviewQueue.length === 0) return;
    if (engineMode === 'predicting') {
      return;
    }
    
    isReviewing = true;
    engineMode = 'reviewing';
    
    activeReviewTask = reviewQueue.shift();
    reviewCandidates = [];
    
    logEngine(`[Reviewing Move ${activeReviewTask.moveIndex + 1}]: ${activeReviewTask.sanMove} (${activeReviewTask.uciMove})`);
    
    sendToEngine('stop');
    sendToEngine('ucinewgame');
    sendToEngine('setoption name MultiPV value 4');
    sendToEngine(`position fen ${activeReviewTask.preMoveFen}`);
    sendToEngine('go depth 8 movetime 350');
  }

  // --- ELO + Accuracy Move Selection Logic ---
  function selectAndDisplaySuggestedMove() {
    if (activeSearchCandidates.length === 0) return;
    
    // Sort candidates by rank ascending
    activeSearchCandidates.sort((a, b) => a.rank - b.rank);
    
    const elo = parseInt(eloSlider.value);
    const accuracy = parseInt(accuracySlider.value);
    
    logEngine(`Analyzing Candidates for ELO ${elo}, Accuracy ${accuracy}%`);
    logEngine(JSON.stringify(activeSearchCandidates));
    
    // Pad candidates if less than 4 exist
    const legalMoves = chess.moves({ verbose: true });
    
    let chosenCandidate = null;
    let chosenQuality = "Best Move";
    let explanation = "";
    
    const roll = Math.random() * 100;
    
    if (roll <= accuracy) {
      // Success! Play the best move (PV 1)
      chosenCandidate = activeSearchCandidates[0];
      chosenQuality = "Best Move";
      explanation = `Based on a simulated ELO of ${elo} and a strong accuracy roll (${roll.toFixed(1)}% vs target ${accuracy}%), the player successfully calculated and selected the top engine recommendation.`;
    } else {
      // Inaccuracy, Mistake, or Blunder triggered!
      let selectionIdx = 1; // Default to PV 2 (Inaccuracy)
      
      if (elo >= 2200) {
        // Grandmaster/Master level: Inaccuracy (80%) or Mistake (20%)
        selectionIdx = Math.random() < 0.8 ? 1 : 2;
      } else if (elo >= 1200) {
        // Intermediate level: Inaccuracy (50%), Mistake (35%), Blunder (15%)
        const r = Math.random();
        if (r < 0.5) selectionIdx = 1;
        else if (r < 0.85) selectionIdx = 2;
        else selectionIdx = 3;
      } else {
        // Beginner level: Inaccuracy (20%), Mistake (40%), Blunder/Random (40%)
        const r = Math.random();
        if (r < 0.2) selectionIdx = 1;
        else if (r < 0.6) selectionIdx = 2;
        else selectionIdx = 3;
      }
      
      // Get chosen candidate or fallback
      if (selectionIdx === 3 && Math.random() < 0.5 && legalMoves.length > 0) {
        // For heavy blunder, sometimes make a completely random legal move
        const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        chosenCandidate = {
          rank: 4,
          uci: randomMove.from + randomMove.to + (randomMove.promotion || ''),
          san: randomMove.san,
          eval: "N/A",
          rawScore: -9999
        };
        chosenQuality = "Blunder";
        explanation = `At ELO ${elo} and accuracy ${accuracy}%, a blunder was triggered. The player overlooked the position details and played a weak random alternative.`;
      } else {
        // Fetch PV 2, 3, or 4
        // If not available, fallback to the worst available candidate
        const targetIdx = Math.min(selectionIdx, activeSearchCandidates.length - 1);
        chosenCandidate = activeSearchCandidates[targetIdx];
        
        if (targetIdx === 1) {
          chosenQuality = "Inaccuracy";
          explanation = `At ELO ${elo} and accuracy ${accuracy}%, the player missed the best line and chose a sub-optimal alternative.`;
        } else if (targetIdx === 2) {
          chosenQuality = "Mistake";
          explanation = `At ELO ${elo} and accuracy ${accuracy}%, the player made a notable mistake, giving the opponent a slight tactical advantage.`;
        } else {
          chosenQuality = "Blunder";
          explanation = `At ELO ${elo} and accuracy ${accuracy}%, the player committed a tactical blunder, yielding significant control over the position.`;
        }
      }
    }
    
    // In case chosenCandidate is still null (e.g. empty array fallbacks)
    if (!chosenCandidate) {
      chosenCandidate = activeSearchCandidates[0];
      chosenQuality = "Best Move";
      explanation = "No alternative candidate moves available. The optimal engine move was selected.";
    }
    
    // Highlight the move on the board representation
    showSuggestionResults(chosenCandidate, chosenQuality, explanation);
  }

  function showSuggestionResults(chosen, quality, explanation) {
    resultsPanel.classList.remove('hidden');
    chosenMoveNotationEl.textContent = chosen.san;
    chosenMoveEvalEl.textContent = `Engine Evaluation: ${chosen.eval}`;
    
    chosenMoveQualityEl.className = 'move-quality-badge';
    chosenMoveQualityEl.classList.add(quality.toLowerCase().replace(' ', '-'));
    chosenMoveQualityEl.textContent = quality;
    
    moveExplanationEl.textContent = explanation;
    
    const from = chosen.uci.substring(0, 2);
    const to = chosen.uci.substring(2, 4);

    // Clear old visual suggestions
    const svg = document.getElementById('board-arrows-svg');
    if (svg) {
      svg.querySelectorAll('line').forEach(l => l.remove());
    }
    
    activeSearchSuggestedMove = {
      from: from,
      to: to
    };
    
    // Draw suggestion path arrow
    drawArrow(from, to, 'suggest');
    
    // Highlight suggestion squares
    const fromSquare = document.querySelector(`.square[data-coord="${from}"]`);
    const toSquare = document.querySelector(`.square[data-coord="${to}"]`);
    if (fromSquare) fromSquare.classList.add('selected');
    if (toSquare) toSquare.classList.add('selected');
    
    // Render the Candidates Table
    candidatesTbody.innerHTML = '';
    
    // Include the random move if it wasn't a standard candidate
    let displayList = [...activeSearchCandidates];
    const isChosenInList = displayList.some(c => c.uci === chosen.uci);
    if (!isChosenInList) {
      displayList.push(chosen);
    }
    
    // Ensure unique elements in list by UCI
    displayList = displayList.filter((value, index, self) =>
      self.findIndex(v => v.uci === value.uci) === index
    );
    
    displayList.forEach(c => {
      const isChosen = c.uci === chosen.uci;
      let label = "Best Move";
      let dotClass = "best";
      
      if (c.rank === 2) { label = "Inaccuracy"; dotClass = "inaccuracy"; }
      else if (c.rank === 3) { label = "Mistake"; dotClass = "mistake"; }
      else if (c.rank >= 4) { label = "Blunder"; dotClass = "blunder"; }
      
      // Calculate selection probability under this setting
      let chance = "0%";
      const elo = parseInt(eloSlider.value);
      const acc = parseInt(accuracySlider.value);
      
      if (c.rank === 1) {
        chance = `${acc}%`;
      } else {
        const failChance = 100 - acc;
        if (elo >= 2200) {
          chance = c.rank === 2 ? `${(failChance * 0.8).toFixed(0)}%` : `${(failChance * 0.2).toFixed(0)}%`;
        } else if (elo >= 1200) {
          if (c.rank === 2) chance = `${(failChance * 0.5).toFixed(0)}%`;
          else if (c.rank === 3) chance = `${(failChance * 0.35).toFixed(0)}%`;
          else chance = `${(failChance * 0.15).toFixed(0)}%`;
        } else {
          if (c.rank === 2) chance = `${(failChance * 0.2).toFixed(0)}%`;
          else if (c.rank === 3) chance = `${(failChance * 0.4).toFixed(0)}%`;
          else chance = `${(failChance * 0.4).toFixed(0)}%`;
        }
      }
      
      const tr = document.createElement('tr');
      if (isChosen) tr.className = 'active-choice';
      
      tr.innerHTML = `
        <td>
          <div class="candidate-quality-cell">
            <span class="quality-dot ${dotClass}"></span>
            <span>${label}</span>
          </div>
        </td>
        <td><span class="candidate-move-name">${c.san}</span></td>
        <td class="candidate-eval-cell">${c.eval}</td>
        <td class="candidate-chance-cell">${chance}</td>
        <td>
          <button class="btn-play-move" data-move="${c.uci}">Play</button>
        </td>
      `;
      
      candidatesTbody.appendChild(tr);
    });
    
    // Add event listeners to Play buttons in the table
    document.querySelectorAll('.btn-play-move').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const uci = e.target.getAttribute('data-move');
        makeUciMove(uci);
        resultsPanel.classList.add('hidden');
      });
    });
  }

  function makeUciMove(uci) {
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci.charAt(4) : null;
    
    const move = chess.move({ from: from, to: to, promotion: promotion || 'q' });
    if (move) {
      clearBoardVisuals();
      selectedSquare = null;
      updateBoardState();
      highlightLastMove(from, to);
    }
  }

  function highlightLastMove(from, to) {
    document.querySelectorAll('.square').forEach(sq => {
      sq.classList.remove('last-move');
    });
    const fromSq = document.querySelector(`.square[data-coord="${from}"]`);
    const toSq = document.querySelector(`.square[data-coord="${to}"]`);
    if (fromSq) fromSq.classList.add('last-move');
    if (toSq) toSq.classList.add('last-move');
  }

  // --- Chess Board Rendering & User Input ---
  function drawBoard() {
    boardEl.innerHTML = '';
    
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    
    if (boardFlipped) {
      files.reverse();
      ranks.reverse();
    }
    
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = files[f];
        const rank = ranks[r];
        const coord = file + rank;
        const isLight = (f + r) % 2 === 0;
        
        const square = document.createElement('div');
        square.className = `square ${isLight ? 'light' : 'dark'}`;
        square.setAttribute('data-coord', coord);
        
        // Add File letters to the bottom row, Ranks to the left row
        if (r === (boardFlipped ? 0 : 7)) {
          square.setAttribute('data-file', file);
          square.classList.add('show-file');
        }
        if (f === (boardFlipped ? 7 : 0)) {
          square.setAttribute('data-rank', rank);
          square.classList.add('show-rank');
        }
        
        // Add piece if exists
        const piece = chess.get(coord);
        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = `piece`;
          pieceEl.style.backgroundImage = `url(${pieceImages[piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()]})`;
          pieceEl.setAttribute('draggable', 'true');
          pieceEl.setAttribute('data-color', piece.color);
          pieceEl.setAttribute('data-square', coord);
          
          // Piece Drag and Drop
          pieceEl.addEventListener('dragstart', handleDragStart);
          pieceEl.addEventListener('dragend', handleDragEnd);
          
          square.appendChild(pieceEl);
        }
        
        // Interaction listeners on square
        square.addEventListener('click', handleSquareClick);
        square.addEventListener('dragover', handleDragOver);
        square.addEventListener('drop', handleDrop);
        
        boardEl.appendChild(square);
      }
    }
    
    // Create and append SVG overlay for arrows
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "board-arrows-svg";
    svg.setAttribute("class", "board-arrows-svg");
    svg.innerHTML = `
      <defs>
        <marker id="arrowhead-best" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(20, 184, 166, 0.85)" />
        </marker>
        <marker id="arrowhead-suggest" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(56, 189, 248, 0.85)" />
        </marker>
      </defs>
    `;
    boardEl.appendChild(svg);
    
    // Apply active review highlights and badges
    if (activeReviewVisual) {
      applyReviewVisual(activeReviewVisual);
    }
    
    // Draw suggestion arrow if set
    if (activeSearchSuggestedMove) {
      drawArrow(activeSearchSuggestedMove.from, activeSearchSuggestedMove.to, 'suggest');
    }
    
    updateSelectionHighlights();
  }

  // --- Click to Move Handling ---
  function handleSquareClick(e) {
    const squareCoord = this.getAttribute('data-coord');
    const pieceEl = this.querySelector('.piece');
    
    // Check if we already have a piece selected
    if (selectedSquare) {
      if (selectedSquare === squareCoord) {
        // Deselect
        selectedSquare = null;
        updateSelectionHighlights();
        return;
      }
      
      // Try to execute a move
      const move = chess.move({
        from: selectedSquare,
        to: squareCoord,
        promotion: 'q' // Auto-promote to Queen for simplicity
      });
      
      if (move) {
        clearBoardVisuals();
        highlightLastMove(selectedSquare, squareCoord);
        selectedSquare = null;
        updateBoardState();
        resultsPanel.classList.add('hidden');
        return;
      }
      
      // If move failed but user clicked another of their own pieces, change selection
      if (pieceEl && pieceEl.getAttribute('data-color') === chess.turn()) {
        selectedSquare = squareCoord;
        updateSelectionHighlights();
      } else {
        // Clear selection
        selectedSquare = null;
        updateSelectionHighlights();
      }
    } else {
      // Select piece if it is the current turn's color
      if (pieceEl && pieceEl.getAttribute('data-color') === chess.turn()) {
        selectedSquare = squareCoord;
        updateSelectionHighlights();
      }
    }
  }

  function updateSelectionHighlights() {
    // Clear all previous highlight classes, dots, and rings
    document.querySelectorAll('.square').forEach(sq => {
      sq.classList.remove('selected');
      const indicatorDot = sq.querySelector('.dest-indicator-dot');
      const indicatorRing = sq.querySelector('.dest-indicator-ring');
      if (indicatorDot) indicatorDot.remove();
      if (indicatorRing) indicatorRing.remove();
    });
    
    if (!selectedSquare) return;
    
    // Add selection class to the selected square
    const activeSq = document.querySelector(`.square[data-coord="${selectedSquare}"]`);
    if (activeSq) activeSq.classList.add('selected');
    
    // Highlight all valid destinations
    const moves = chess.moves({ square: selectedSquare, verbose: true });
    moves.forEach(m => {
      const destSq = document.querySelector(`.square[data-coord="${m.to}"]`);
      if (destSq) {
        const hasPiece = destSq.querySelector('.piece');
        if (hasPiece) {
          const ring = document.createElement('div');
          ring.className = 'dest-indicator-ring';
          destSq.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'dest-indicator-dot';
          destSq.appendChild(dot);
        }
      }
    });
  }

  // --- Drag and Drop Handling ---
  let draggedPiece = null;
  
  function handleDragStart(e) {
    if (this.getAttribute('data-color') !== chess.turn()) {
      e.preventDefault();
      return;
    }
    draggedPiece = this;
    this.classList.add('dragging');
    selectedSquare = this.getAttribute('data-square');
    updateSelectionHighlights();
    e.dataTransfer.setData('text/plain', selectedSquare);
  }

  function handleDragEnd() {
    if (draggedPiece) {
      draggedPiece.classList.remove('dragging');
    }
    draggedPiece = null;
    selectedSquare = null;
    updateSelectionHighlights();
  }

  function handleDragOver(e) {
    e.preventDefault(); // Required to allow dropping
  }

  function handleDrop(e) {
    e.preventDefault();
    const fromCoord = e.dataTransfer.getData('text/plain');
    const toCoord = this.getAttribute('data-coord');
    
    if (fromCoord && toCoord && fromCoord !== toCoord) {
      const move = chess.move({
        from: fromCoord,
        to: toCoord,
        promotion: 'q'
      });
      
      if (move) {
        clearBoardVisuals();
        highlightLastMove(fromCoord, toCoord);
        updateBoardState();
        resultsPanel.classList.add('hidden');
      }
    }
  }

  // --- Board State Updates ---
  function updateBoardState() {
    drawBoard();
    
    // Update Turn Indicator / Checkmate details
    let statusText = "";
    const activeColor = chess.turn() === 'w' ? "White" : "Black";
    
    if (chess.in_checkmate()) {
      statusText = `Game Over! Checkmate. ${activeColor} loses.`;
      gameStatusEl.style.color = 'var(--color-danger)';
    } else if (chess.in_draw()) {
      statusText = "Game Over! Draw.";
      gameStatusEl.style.color = 'var(--color-warning)';
    } else if (chess.in_check()) {
      statusText = `${activeColor} to move - Check!`;
      gameStatusEl.style.color = 'var(--color-danger)';
    } else {
      statusText = `${activeColor}'s turn`;
      gameStatusEl.style.color = 'var(--text-main)';
    }
    
    gameStatusEl.textContent = statusText;
    
    // Update FEN inputs
    const fen = chess.fen();
    fenInputEl.value = fen;
    fenPreviewTextEl.textContent = fen.substring(0, 30) + (fen.length > 30 ? '...' : '');
    
    // Detect new moves for Game Review
    const history = chess.history({ verbose: true });
    if (history.length > moveReviews.length) {
      for (let i = moveReviews.length; i < history.length; i++) {
        const moveObj = history[i];
        
        // Add the current FEN to the history for the next ply
        if (fenHistory.length <= i + 1) {
          fenHistory.push(fen);
        }
        
        const preFen = fenHistory[i] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        
        // Initialize move review entry
        moveReviews.push({
          san: moveObj.san,
          quality: 'loading',
          eval: '...',
          loss: 0
        });
        
        // Check if it's a Book Move
        const sequence = history.slice(0, i + 1).map(m => m.san).join(' ');
        if (isBookMoveSequence(sequence)) {
          moveReviews[i] = {
            san: moveObj.san,
            quality: 'book',
            eval: 'Book',
            loss: 0
          };
          updateReviewScorecard();
          
          if (i === history.length - 1) {
            activeReviewVisual = {
              from: moveObj.from,
              to: moveObj.to,
              quality: 'book',
              bestFrom: null,
              bestTo: null
            };
            applyReviewVisual(activeReviewVisual);
          }
        } else {
          // Add to evaluation queue
          reviewQueue.push({
            preMoveFen: preFen,
            uciMove: moveObj.from + moveObj.to + (moveObj.promotion || ''),
            sanMove: moveObj.san,
            moveIndex: i,
            moveObj: moveObj
          });
        }
      }
      
      // Start processing background reviews
      processReviewQueue();
    }
    
    // Update move history panel
    renderMoveHistory();
  }

  function renderMoveHistory() {
    movesHistoryEl.innerHTML = '';
    const history = chess.history({ verbose: true });
    
    if (history.length === 0) {
      movesHistoryEl.innerHTML = '<div class="empty-history-text">No moves played yet. Start dragging pieces or click Suggest to begin!</div>';
      return;
    }
    
    // Group moves into pairs (turns)
    const turns = [];
    for (let i = 0; i < history.length; i += 2) {
      const whiteMove = history[i];
      const blackMove = history[i + 1] || null;
      turns.push({
        num: Math.floor(i / 2) + 1,
        white: whiteMove,
        black: blackMove
      });
    }
    
    turns.forEach(t => {
      const turnDiv = document.createElement('div');
      turnDiv.className = 'history-turn';
      
      const whiteIdx = (t.num - 1) * 2;
      const whiteReview = moveReviews[whiteIdx];
      let whiteHtml = `<span class="history-move-item" data-index="${whiteIdx}">${t.white.san}`;
      if (whiteReview) {
        if (whiteReview.quality === 'loading') {
          whiteHtml += `<span class="history-move-badge loading" title="Analyzing...">...</span>`;
        } else {
          const symbol = getBadgeSymbol(whiteReview.quality);
          whiteHtml += `<span class="history-move-badge ${whiteReview.quality}" title="${whiteReview.quality.toUpperCase()} (eval: ${whiteReview.eval})">${symbol}</span>`;
        }
      }
      whiteHtml += `</span>`;
      
      let blackHtml = "";
      if (t.black) {
        const blackIdx = (t.num - 1) * 2 + 1;
        const blackReview = moveReviews[blackIdx];
        blackHtml = `<span class="history-move-item" data-index="${blackIdx}">${t.black.san}`;
        if (blackReview) {
          if (blackReview.quality === 'loading') {
            blackHtml += `<span class="history-move-badge loading" title="Analyzing...">...</span>`;
          } else {
            const symbol = getBadgeSymbol(blackReview.quality);
            blackHtml += `<span class="history-move-badge ${blackReview.quality}" title="${blackReview.quality.toUpperCase()} (eval: ${blackReview.eval})">${symbol}</span>`;
          }
        }
        blackHtml += `</span>`;
      }
      
      turnDiv.innerHTML = `
        <span class="turn-num">${t.num}.</span>
        ${whiteHtml}
        ${blackHtml}
      `;
      movesHistoryEl.appendChild(turnDiv);
    });
    
    // Auto-scroll move history to bottom
    movesHistoryEl.scrollTop = movesHistoryEl.scrollHeight;
  }

  // --- Setting Classifications based on Sliders ---
  function updateAccuracyClassification() {
    const val = parseInt(accuracySlider.value);
    accuracyValEl.textContent = val;
    
    let text = "";
    let color = "";
    
    if (val <= 25) {
      text = "Complete Beginner / Chaos (Frequent Blunders)";
      color = 'var(--color-danger)';
    } else if (val <= 50) {
      text = "Casual Play (Several Mistakes & Blunders)";
      color = 'var(--color-warning)';
    } else if (val <= 75) {
      text = "Solid Play (Occasional Inaccuracies)";
      color = '#38bdf8'; // light blue
    } else if (val <= 90) {
      text = "Excellent Play (Masterful Accuracy)";
      color = '#a7f3d0'; // emerald green light
    } else {
      text = "Engine Precision (Near-Perfect Execution)";
      color = 'var(--color-primary)';
    }
    
    accuracyClassEl.textContent = text;
    accuracyClassEl.style.color = color;
  }

  // --- Trigger Chess Prediction ---
  function runEngineCalculation() {
    if (!engineReady) return;
    
    const fen = chess.fen();
    const elo = parseInt(eloSlider.value);
    
    // Clear previous search candidates
    activeSearchCandidates = [];
    currentSearchId++;
    
    // Stop reviews to prioritize manual calculation
    sendToEngine('stop');
    isReviewing = false;
    engineMode = 'predicting';
    
    // Enable Spinner UI
    predictSpinner.classList.remove('hidden');
    btnPredict.disabled = true;
    btnPredictText.textContent = 'Calculating Next Move...';
    
    // Calculate appropriate depth and ELO limits
    let depth = 10;
    
    // Reset engine settings before new search
    sendToEngine('ucinewgame');
    
    if (elo >= 2900) {
      // Full power Stockfish
      sendToEngine('setoption name UCI_LimitStrength value false');
      depth = 15;
    } else {
      sendToEngine('setoption name UCI_LimitStrength value true');
      // Stockfish native ELO min is 1350, max is 2850
      const targetElo = Math.max(1350, Math.min(2850, elo));
      sendToEngine(`setoption name UCI_Elo value ${targetElo}`);
      
      // Manually limit depth for lower ELO settings
      if (elo < 1350) {
        depth = Math.max(1, Math.floor((elo - 400) / 200)); // E.g., ELO 500 = depth 1, 1000 = depth 3
      } else if (elo < 1800) {
        depth = 6;
      } else if (elo < 2400) {
        depth = 9;
      } else {
        depth = 12;
      }
    }
    
    // Set position and search
    sendToEngine(`position fen ${fen}`);
    // Limit calculation time to 1.5 seconds max (1500ms) or target depth, whichever is first
    sendToEngine(`go depth ${depth} movetime 1500`);
  }

  // --- Setup Event Listeners ---
  
  // Slider Controls
  eloSlider.addEventListener('input', () => {
    eloValEl.textContent = eloSlider.value;
  });
  
  accuracySlider.addEventListener('input', updateAccuracyClassification);
  
  // Predict CTA
  btnPredict.addEventListener('click', runEngineCalculation);
  
  // Flip Board
  btnFlip.addEventListener('click', () => {
    boardFlipped = !boardFlipped;
    drawBoard();
  });
  
  // Reset Board
  btnReset.addEventListener('click', () => {
    if (confirm("Reset the chessboard to the starting position?")) {
      chess.reset();
      selectedSquare = null;
      resultsPanel.classList.add('hidden');
      
      // Reset review database
      moveReviews = [];
      reviewQueue = [];
      isReviewing = false;
      fenHistory = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
      updateReviewScorecard();
      clearBoardVisuals();
      
      updateBoardState();
    }
  });
  
  // Load FEN
  btnLoadFen.addEventListener('click', () => {
    const fen = fenInputEl.value.trim();
    const result = chess.load(fen);
    
    if (result) {
      selectedSquare = null;
      resultsPanel.classList.add('hidden');
      
      // Reset review database starting from this new FEN
      moveReviews = [];
      reviewQueue = [];
      isReviewing = false;
      fenHistory = [fen];
      updateReviewScorecard();
      clearBoardVisuals();
      
      updateBoardState();
    } else {
      alert("Invalid FEN string. Please check the chess layout details.");
    }
  });

  // Copy PGN to clipboard
  btnCopyPgn.addEventListener('click', () => {
    const pgn = chess.pgn();
    if (!pgn || pgn.trim() === '') {
      alert("No moves played yet to generate PGN.");
      return;
    }
    navigator.clipboard.writeText(pgn).then(() => {
      btnCopyPgn.textContent = 'Copied!';
      setTimeout(() => {
        btnCopyPgn.textContent = 'Copy PGN';
      }, 1500);
    }).catch(err => {
      console.error('Could not copy PGN: ', err);
    });
  });
  
  // Download PGN file
  btnExportPgn.addEventListener('click', () => {
    const pgn = chess.pgn();
    if (!pgn || pgn.trim() === '') {
      alert("No moves played yet to export PGN.");
      return;
    }
    
    const blob = new Blob([pgn], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess_game_${new Date().toISOString().slice(0,10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  
  // Copy FEN to clipboard
  btnCopyFen.addEventListener('click', () => {
    const fen = chess.fen();
    navigator.clipboard.writeText(fen).then(() => {
      btnCopyFen.textContent = 'Copied!';
      setTimeout(() => {
        btnCopyFen.textContent = 'Copy FEN';
      }, 1500);
    }).catch(err => {
      console.error('Could not copy FEN: ', err);
    });
  });
  
  // Console Log Toggle
  btnToggleLog.addEventListener('click', (e) => {
    e.preventDefault();
    engineLogContainer.classList.toggle('hidden');
    if (!engineLogContainer.classList.contains('hidden')) {
      engineLogEl.scrollTop = engineLogEl.scrollHeight;
    }
  });
  
  btnClearLog.addEventListener('click', () => {
    uciResponseLog = [];
    engineLogEl.textContent = '';
  });

  // --- Initializing Board and Loaders ---
  if (window.location.protocol === 'file:') {
    const warningOverlay = document.getElementById('file-warning-overlay');
    if (warningOverlay) {
      warningOverlay.classList.remove('hidden');
    }
    
    const btnDismiss = document.getElementById('btn-warning-dismiss');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => {
        warningOverlay.classList.add('hidden');
      });
    }
  }

  initEngine();
  updateBoardState();
  updateAccuracyClassification();
});
