
import React from 'react';

export const MountainScene: React.FC = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Background Gradients - Mystical Pink/Purple Twilight */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-fuchsia-950 to-pink-950" />
      
      {/* Stars */}
      <div className="absolute inset-0 opacity-20">
        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-pink-100 rounded-full animate-pulse"
            style={{
              top: `${Math.random() * 60}%`,
              left: `${Math.random() * 100}%`,
              width: `${Math.random() * 2.5}px`,
              height: `${Math.random() * 2.5}px`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      {/* Far Mountains */}
      <svg className="absolute bottom-0 w-full h-[60%] text-fuchsia-900/30" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path fill="currentColor" d="M0,224L80,192C160,160,320,96,480,96C640,96,800,160,960,197.3C1120,235,1280,245,1360,250.7L1440,256L1440,320L1360,320C1280,320,1120,320,960,320C800,320,640,320,480,320C320,320,160,320,80,320L0,320Z"></path>
      </svg>

      {/* Mid Mountains */}
      <svg className="absolute bottom-0 w-full h-[45%] text-pink-950/50" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path fill="currentColor" d="M0,128L120,160C240,192,480,256,720,256C960,256,1200,192,1320,160L1440,128L1440,320L1320,320C1200,320,960,320,720,320C480,320,240,320,120,320L0,320Z"></path>
      </svg>

      {/* Front Mountains */}
      <svg className="absolute bottom-0 w-full h-[30%] text-slate-950" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path fill="currentColor" d="M0,256L120,224C240,192,480,128,720,160C960,192,1200,320,1320,384L1440,448L1440,320L1320,320C1200,320,960,320,720,320C480,320,240,320,120,320L0,320Z"></path>
      </svg>

      {/* Fog Overlay - Pink Mist */}
      <div className="absolute bottom-0 w-full h-48 bg-gradient-to-t from-slate-950 via-pink-950/20 to-transparent opacity-40" />
    </div>
  );
};
