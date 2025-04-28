// src/App.js
import React from 'react';
import './App.css';
import AIModelComponent from './components/AIModelComponent';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>✨ AI in Your Browser</h1>
        <p>Unleash the power of local AI, right at your fingertips</p>
      </header>
      <main>
        <AIModelComponent />
      </main>
      <footer>
        <p>🚀 100% Local, 100% Private - Your Browser is Now a Supercomputer! 🔒</p>
      </footer>
    </div>
  );
}

export default App;
