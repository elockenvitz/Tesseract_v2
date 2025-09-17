import React, { useState } from 'react'

interface TesseractLogoProps {
  size?: number
  className?: string
}

export function TesseractLogo({ size = 32, className = '' }: TesseractLogoProps) {
  const [isAnimating, setIsAnimating] = useState(false)

  return (
    <div
      className={`cursor-pointer transition-transform duration-200 hover:scale-105 ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={() => setIsAnimating(true)}
      onMouseLeave={() => setIsAnimating(false)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="transition-all duration-300"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <defs>
          <style>
            {`
              /* Stable class-based animations */
              .tesseract-logo.animating .vertex-0 {
                animation: vertex-0-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-1 {
                animation: vertex-1-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-2 {
                animation: vertex-2-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-3 {
                animation: vertex-3-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-4 {
                animation: vertex-4-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-5 {
                animation: vertex-5-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-6 {
                animation: vertex-6-4d 4s ease-in-out infinite;
              }
              .tesseract-logo.animating .vertex-7 {
                animation: vertex-7-4d 4s ease-in-out infinite;
              }

              /* EXTREME 4D vertex transformations - very large position changes */
              @keyframes vertex-0-4d {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                50% { transform: translate(50px, 50px) scale(2); opacity: 0.3; }
                100% { transform: translate(0, 0) scale(1); opacity: 1; }
              }

              @keyframes vertex-1-4d {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                50% { transform: translate(-50px, 50px) scale(2); opacity: 0.3; }
                100% { transform: translate(0, 0) scale(1); opacity: 1; }
              }

              @keyframes vertex-2-4d {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                50% { transform: translate(-50px, -50px) scale(2); opacity: 0.3; }
                100% { transform: translate(0, 0) scale(1); opacity: 1; }
              }

              @keyframes vertex-3-4d {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                50% { transform: translate(50px, -50px) scale(2); opacity: 0.3; }
                100% { transform: translate(0, 0) scale(1); opacity: 1; }
              }

              @keyframes vertex-4-4d {
                0% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
                50% { transform: translate(-40px, -40px) scale(2.5); opacity: 1; }
                100% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
              }

              @keyframes vertex-5-4d {
                0% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
                50% { transform: translate(40px, -40px) scale(2.5); opacity: 1; }
                100% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
              }

              @keyframes vertex-6-4d {
                0% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
                50% { transform: translate(40px, 40px) scale(2.5); opacity: 1; }
                100% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
              }

              @keyframes vertex-7-4d {
                0% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
                50% { transform: translate(-40px, 40px) scale(2.5); opacity: 1; }
                100% { transform: translate(0, 0) scale(0.8); opacity: 0.8; }
              }

              /* Stable edge animations */
              .tesseract-logo.animating .edge-dynamic {
                animation: edge-morph-dramatic 4s linear infinite;
              }

              .tesseract-logo.animating .tesseract-edge {
                animation: static-edge-pulse 4s linear infinite;
              }

              @keyframes edge-morph-dramatic {
                0% { opacity: 0.7; stroke-width: 1; stroke-dasharray: 0, 0; transform: scale(1) rotate(0deg); }
                25% { opacity: 0.3; stroke-width: 4; stroke-dasharray: 8, 4; transform: scale(0.6) rotate(90deg); }
                50% { opacity: 1; stroke-width: 0.5; stroke-dasharray: 2, 6; transform: scale(1.5) rotate(180deg); }
                75% { opacity: 0.5; stroke-width: 3; stroke-dasharray: 6, 2; transform: scale(0.8) rotate(270deg); }
                100% { opacity: 0.7; stroke-width: 1; stroke-dasharray: 0, 0; transform: scale(1) rotate(360deg); }
              }

              @keyframes static-edge-pulse {
                0% { opacity: 0.8; stroke-width: 1.5; }
                25% { opacity: 0.4; stroke-width: 0.8; }
                50% { opacity: 1; stroke-width: 2.5; }
                75% { opacity: 0.6; stroke-width: 1.2; }
                100% { opacity: 0.8; stroke-width: 1.5; }
              }

              /* Remove conflicting whole-tesseract animation */

              /* Bold yellow tesseract color scheme */
              .tesseract-vertex {
                fill: #f59e0b;
                stroke: #d97706;
                stroke-width: 1.5;
              }

              .tesseract-edge {
                stroke: #f59e0b;
                stroke-width: 3;
                fill: none;
                opacity: 1;
              }

              .edge-dynamic {
                stroke: #fbbf24;
                stroke-width: 2.5;
                fill: none;
                opacity: 0.9;
                stroke-dasharray: 3, 2;
              }
            `}
          </style>
        </defs>

        <g className={`tesseract-logo ${isAnimating ? 'animating' : ''}`}>
          {/* 8 Tesseract vertices that move through 4D space */}
          <circle className="tesseract-vertex vertex-0" cx="15" cy="15" r="3" />
          <circle className="tesseract-vertex vertex-1" cx="85" cy="15" r="3" />
          <circle className="tesseract-vertex vertex-2" cx="85" cy="85" r="3" />
          <circle className="tesseract-vertex vertex-3" cx="15" cy="85" r="3" />
          <circle className="tesseract-vertex vertex-4" cx="30" cy="30" r="2.5" />
          <circle className="tesseract-vertex vertex-5" cx="70" cy="30" r="2.5" />
          <circle className="tesseract-vertex vertex-6" cx="70" cy="70" r="2.5" />
          <circle className="tesseract-vertex vertex-7" cx="30" cy="70" r="2.5" />

          {/* Static connecting lines that form the tesseract structure */}
          <line className="tesseract-edge" x1="15" y1="15" x2="85" y2="15" />
          <line className="tesseract-edge" x1="85" y1="15" x2="85" y2="85" />
          <line className="tesseract-edge" x1="85" y1="85" x2="15" y2="85" />
          <line className="tesseract-edge" x1="15" y1="85" x2="15" y2="15" />

          <line className="tesseract-edge" x1="30" y1="30" x2="70" y2="30" />
          <line className="tesseract-edge" x1="70" y1="30" x2="70" y2="70" />
          <line className="tesseract-edge" x1="70" y1="70" x2="30" y2="70" />
          <line className="tesseract-edge" x1="30" y1="70" x2="30" y2="30" />

          {/* 4D connecting edges between the two cube projections */}
          <line className="edge-dynamic" x1="15" y1="15" x2="30" y2="30" />
          <line className="edge-dynamic" x1="85" y1="15" x2="70" y2="30" />
          <line className="edge-dynamic" x1="85" y1="85" x2="70" y2="70" />
          <line className="edge-dynamic" x1="15" y1="85" x2="30" y2="70" />

          {/* Additional connecting lines for 4D structure */}
          <line className="edge-dynamic" x1="15" y1="15" x2="85" y2="85" />
          <line className="edge-dynamic" x1="85" y1="15" x2="15" y2="85" />
          <line className="edge-dynamic" x1="30" y1="30" x2="70" y2="70" />
          <line className="edge-dynamic" x1="70" y1="30" x2="30" y2="70" />

          {/* Central core point */}
          <circle className="tesseract-vertex" cx="50" cy="50" r="1.5" />
        </g>
      </svg>
    </div>
  )
}