import React from 'react'

interface TesseractSpinnerProps {
  size?: number
  className?: string
}

export function TesseractSpinner({ size = 20, className = '' }: TesseractSpinnerProps) {
  return (
    <div className={`inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="animate-spin"
      >
        <defs>
          <style>
            {`
              @keyframes tesseract-mini-morph {
                0%, 100% {
                  transform: scale(1) rotate(0deg);
                  opacity: 0.8;
                }
                50% {
                  transform: scale(0.6) rotate(180deg);
                  opacity: 1;
                }
              }

              .tesseract-mini-outer {
                animation: tesseract-mini-morph 2s ease-in-out infinite;
                transform-origin: 50px 50px;
              }

              .tesseract-mini-edge {
                stroke: #3b82f6;
                stroke-width: 3;
                fill: none;
                opacity: 0.7;
              }

              .tesseract-mini-vertex {
                fill: #1d4ed8;
                opacity: 0.9;
              }

              .tesseract-mini-center {
                fill: #1d4ed8;
                opacity: 0.8;
              }
            `}
          </style>
        </defs>

        <g className="tesseract-mini-outer">
          {/* Outer square */}
          <rect className="tesseract-mini-edge" x="25" y="25" width="50" height="50" rx="4" />

          {/* Inner square */}
          <rect className="tesseract-mini-edge" x="37.5" y="37.5" width="25" height="25" rx="2" />

          {/* Connecting lines */}
          <line className="tesseract-mini-edge" x1="25" y1="25" x2="37.5" y2="37.5" />
          <line className="tesseract-mini-edge" x1="75" y1="25" x2="62.5" y2="37.5" />
          <line className="tesseract-mini-edge" x1="75" y1="75" x2="62.5" y2="62.5" />
          <line className="tesseract-mini-edge" x1="25" y1="75" x2="37.5" y2="62.5" />

          {/* Corner vertices */}
          <circle className="tesseract-mini-vertex" cx="25" cy="25" r="2" />
          <circle className="tesseract-mini-vertex" cx="75" cy="25" r="2" />
          <circle className="tesseract-mini-vertex" cx="75" cy="75" r="2" />
          <circle className="tesseract-mini-vertex" cx="25" cy="75" r="2" />

          {/* Inner vertices */}
          <circle className="tesseract-mini-vertex" cx="37.5" cy="37.5" r="1.5" />
          <circle className="tesseract-mini-vertex" cx="62.5" cy="37.5" r="1.5" />
          <circle className="tesseract-mini-vertex" cx="62.5" cy="62.5" r="1.5" />
          <circle className="tesseract-mini-vertex" cx="37.5" cy="62.5" r="1.5" />

          {/* Center point */}
          <circle className="tesseract-mini-center" cx="50" cy="50" r="2.5" />
        </g>
      </svg>
    </div>
  )
}