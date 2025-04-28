// src/App.js
import React from 'react';
import './App.css';
import AIModelComponent from './components/AIModelComponent';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Browser-based AI Demo</h1>
        <p>Running ML models entirely in your web browser</p>
      </header>
      <main>
        <AIModelComponent />
      </main>
      <footer>
        <p>Model runs locally in your browser - no server needed!</p>
      </footer>
    </div>
  );
}

export default App;