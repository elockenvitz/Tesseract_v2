import React from 'react'

interface TesseractLoaderProps {
  size?: number
  className?: string
  showText?: boolean
  text?: string
}

export function TesseractLoader({
  size = 80,
  className = '',
  showText = true,
  text = 'Loading...'
}: TesseractLoaderProps) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className="drop-shadow-lg"
        >
          <defs>
            <style>
              {`
                @keyframes tesseract-rotate {
                  0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
                  25% { transform: rotateX(15deg) rotateY(90deg) rotateZ(15deg); }
                  50% { transform: rotateX(0deg) rotateY(180deg) rotateZ(0deg); }
                  75% { transform: rotateX(-15deg) rotateY(270deg) rotateZ(-15deg); }
                  100% { transform: rotateX(0deg) rotateY(360deg) rotateZ(0deg); }
                }

                @keyframes tesseract-morph {
                  0%, 100% {
                    transform: scale(1) translate(0, 0);
                    opacity: 0.9;
                  }
                  25% {
                    transform: scale(0.7) translate(-3px, -3px);
                    opacity: 1;
                  }
                  50% {
                    transform: scale(1.2) translate(2px, 2px);
                    opacity: 0.8;
                  }
                  75% {
                    transform: scale(0.8) translate(-1px, 1px);
                    opacity: 0.95;
                  }
                }

                @keyframes tesseract-inner {
                  0%, 100% {
                    transform: scale(0.5) rotate(0deg);
                    opacity: 0.7;
                  }
                  25% {
                    transform: scale(0.8) rotate(90deg);
                    opacity: 1;
                  }
                  50% {
                    transform: scale(0.3) rotate(180deg);
                    opacity: 0.8;
                  }
                  75% {
                    transform: scale(0.6) rotate(270deg);
                    opacity: 0.9;
                  }
                }

                @keyframes tesseract-pulse {
                  0%, 100% { opacity: 0.6; }
                  50% { opacity: 1; }
                }

                @keyframes tesseract-connect {
                  0%, 100% { stroke-dashoffset: 0; opacity: 0.5; }
                  50% { stroke-dashoffset: 10; opacity: 1; }
                }

                .tesseract-outer {
                  animation: tesseract-rotate 4s linear infinite, tesseract-morph 3s ease-in-out infinite;
                  transform-origin: 50px 50px;
                }

                .tesseract-inner {
                  animation: tesseract-inner 5s linear infinite reverse;
                  transform-origin: 50px 50px;
                }

                .tesseract-edge {
                  stroke: #3b82f6;
                  stroke-width: 2;
                  fill: none;
                  opacity: 0.8;
                  animation: tesseract-pulse 2s ease-in-out infinite;
                }

                .tesseract-connecting {
                  stroke: #1d4ed8;
                  stroke-width: 1.5;
                  fill: none;
                  stroke-dasharray: 4;
                  animation: tesseract-connect 2.5s ease-in-out infinite;
                }

                .tesseract-vertex {
                  fill: #1d4ed8;
                  stroke: #1e40af;
                  stroke-width: 1;
                  animation: tesseract-pulse 1.8s ease-in-out infinite;
                }

                .tesseract-face {
                  fill: rgba(59, 130, 246, 0.15);
                  stroke: #3b82f6;
                  stroke-width: 1;
                  opacity: 0.6;
                  animation: tesseract-pulse 2.2s ease-in-out infinite;
                }

                .tesseract-center {
                  fill: #1d4ed8;
                  animation: tesseract-pulse 1.5s ease-in-out infinite;
                }
              `}
            </style>
          </defs>

          {/* Outer cube */}
          <g className="tesseract-outer">
            {/* Outer vertices */}
            <circle className="tesseract-vertex" cx="20" cy="20" r="3" />
            <circle className="tesseract-vertex" cx="80" cy="20" r="3" />
            <circle className="tesseract-vertex" cx="80" cy="80" r="3" />
            <circle className="tesseract-vertex" cx="20" cy="80" r="3" />

            {/* Outer edges */}
            <line className="tesseract-edge" x1="20" y1="20" x2="80" y2="20" />
            <line className="tesseract-edge" x1="80" y1="20" x2="80" y2="80" />
            <line className="tesseract-edge" x1="80" y1="80" x2="20" y2="80" />
            <line className="tesseract-edge" x1="20" y1="80" x2="20" y2="20" />

            {/* Outer face */}
            <rect className="tesseract-face" x="20" y="20" width="60" height="60" />
          </g>

          {/* Inner cube */}
          <g className="tesseract-inner">
            {/* Inner vertices */}
            <circle className="tesseract-vertex" cx="35" cy="35" r="2.5" />
            <circle className="tesseract-vertex" cx="65" cy="35" r="2.5" />
            <circle className="tesseract-vertex" cx="65" cy="65" r="2.5" />
            <circle className="tesseract-vertex" cx="35" cy="65" r="2.5" />

            {/* Inner edges */}
            <line className="tesseract-edge" x1="35" y1="35" x2="65" y2="35" />
            <line className="tesseract-edge" x1="65" y1="35" x2="65" y2="65" />
            <line className="tesseract-edge" x1="65" y1="65" x2="35" y2="65" />
            <line className="tesseract-edge" x1="35" y1="65" x2="35" y2="35" />

            {/* Inner face */}
            <rect className="tesseract-face" x="35" y="35" width="30" height="30" />
          </g>

          {/* Connecting edges (4D projection) */}
          <line className="tesseract-connecting" x1="20" y1="20" x2="35" y2="35" />
          <line className="tesseract-connecting" x1="80" y1="20" x2="65" y2="35" />
          <line className="tesseract-connecting" x1="80" y1="80" x2="65" y2="65" />
          <line className="tesseract-connecting" x1="20" y1="80" x2="35" y2="65" />

          {/* Central morphing point */}
          <circle className="tesseract-center" cx="50" cy="50" r="4" />
        </svg>
      </div>

      {showText && (
        <div className="mt-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{text}</h2>
          <div className="flex justify-center space-x-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      )}
    </div>
  )
}