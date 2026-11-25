// Theme-matched technical line-art device illustrations (RaspAP CAD style + GL.iNet hardware profiles).
// Automatically selects the matching vector by OpenWrt `board_name` (from `system.board`).

function renderGlMt3000Svg({ online, apUp }) {
  const ledFill = online ? 'var(--led-up, #a1ec38)' : apUp ? 'var(--led-warn, #ffbf00)' : 'var(--text-light)';
  const ledGlow = online ? 'filter="url(#pap-led-glow)"' : '';

  return `
    <svg viewBox="0 0 264 192" width="218" height="158" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GL.iNet GL-MT3000 (Beryl AX)">
      <defs>
        <filter id="pap-led-glow" x="-60%" y="-120%" width="220%" height="340%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Soft ground shadow -->
      <ellipse cx="136" cy="166" rx="92" ry="12" fill="var(--accent-soft)" opacity="0.75"/>

      <!-- BACK-LEFT UPRIGHT PADDLE ANTENNA (180-deg folding paddle) -->
      <g>
        <!-- Antenna body (depth side) -->
        <path d="M 33 34 C 33 17, 49 12, 57 18 L 62 21 C 66 24, 68 30, 68 39 L 70 112 C 70 120, 65 127, 56 128 L 47 127 C 39 125, 35 118, 35 109 Z"
              fill="var(--surface-alt)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        <!-- Antenna front face -->
        <path d="M 41 36 C 41 21, 53 16, 61 21 C 66 24, 68 31, 68 39 L 70 110 C 70 119, 63 127, 55 127 C 46 127, 42 120, 42 111 Z"
              fill="var(--surface)" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
        <!-- Inner recessed antenna groove -->
        <path d="M 46 40 C 46 28, 55 24, 61 28 C 63 30, 64 34, 64 40 L 65 98 C 65 104, 61 109, 55 109 C 50 109, 47 104, 47 98 Z"
              fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.55"/>
      </g>

      <!-- RUBBER FEET (subtle rounded pads under chassis) -->
      <path d="M 59 135 C 61 141, 71 142, 74 138" fill="var(--surface-alt)" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M 149 158 C 151 164, 161 165, 165 160" fill="var(--surface-alt)" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>

      <!-- MAIN GL-MT3000 PILLOWY ROUNDED CHASSIS (3/4 isometric perspective) -->
      <g>
        <!-- Outer chassis silhouette -->
        <path d="M 44 104
                 C 43 87, 52 75, 68 70
                 L 116 57
                 C 131 53, 146 54, 162 59
                 L 216 74
                 C 231 79, 240 91, 239 109
                 C 238 124, 229 135, 214 141
                 L 182 154
                 C 168 159, 154 160, 139 156
                 L 60 135
                 C 48 131, 43 120, 44 104 Z"
              fill="var(--surface)" stroke="var(--accent)" stroke-width="2.1" stroke-linejoin="round"/>

        <!-- Subtle top pillow highlight surface -->
        <path d="M 55 92
                 C 57 81, 65 75, 76 72
                 L 119 60
                 C 132 57, 145 58, 158 62
                 L 210 77
                 C 220 80, 226 86, 227 93
                 C 224 96, 218 99, 210 102
                 L 174 114
                 C 161 118, 147 119, 133 115
                 L 64 98
                 C 58 96, 55 94, 55 92 Z"
              fill="var(--accent-soft)" opacity="0.45"/>

        <!-- Lower belly shading -->
        <path d="M 45 113
                 L 140 139
                 C 155 143, 169 142, 182 137
                 L 234 116
                 C 232 128, 224 136, 212 141
                 L 181 153
                 C 168 158, 154 159, 139 155
                 L 60 134
                 C 50 130, 45 122, 45 113 Z"
              fill="var(--surface-alt)" opacity="0.65"/>

        <!-- Front parting seam across rounded nose -->
        <path d="M 44 110 L 140 136 C 151 139, 160 139, 168 137"
              fill="none" stroke="var(--accent)" stroke-width="1.25" opacity="0.8"/>

        <!-- CENTER FRONT STATUS LED (Beryl AX signature slim pill light) -->
        <path d="M 86 121.5 L 104 126.4 C 106 127, 106 130.2, 103.5 129.8 L 85.5 124.9 C 83.6 124.3, 83.8 121, 86 121.5 Z"
              fill="${ledFill}" stroke="var(--accent)" stroke-width="1.1" ${ledGlow}/>

        <!-- RIGHT SIDE RECESSED LOUVERED VENT PANEL -->
        <g>
          <path d="M 192 98 L 226 87 C 234 85, 237 94, 236 106 C 235 118, 230 125, 222 128 L 190 140 C 185 142, 182 136, 183 126 L 185 107 C 186 102, 188 99, 192 98 Z"
                fill="var(--surface-alt)" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/>
          <!-- Vertical cooling vent slats following perspective -->
          <g stroke="var(--accent)" stroke-width="1.15" stroke-linecap="round" opacity="0.72">
            <line x1="192" y1="103" x2="191" y2="134"/>
            <line x1="197" y1="101" x2="196" y2="132"/>
            <line x1="202" y1="99.5" x2="201" y2="130"/>
            <line x1="207" y1="98" x2="206" y2="128"/>
            <line x1="212" y1="96.5" x2="211" y2="126"/>
            <line x1="217" y1="95" x2="216" y2="124"/>
            <line x1="222" y1="93.5" x2="221" y2="122"/>
            <line x1="227" y1="92.5" x2="226" y2="119"/>
            <line x1="231.5" y1="94" x2="230.5" y2="115"/>
          </g>
        </g>
      </g>

      <!-- FRONT-RIGHT UPRIGHT PADDLE ANTENNA (hero foreground with WiFi 6 mark) -->
      <g>
        <!-- Left 3D edge thickness -->
        <path d="M 164 49
                 C 164 31, 178 25, 188 31
                 L 195 34
                 C 200 37, 203 44, 203 54
                 L 199 144
                 C 199 156, 190 164, 179 163
                 L 171 161
                 C 163 158, 160 150, 160 139 Z"
              fill="var(--surface-alt)" stroke="var(--accent)" stroke-width="2.1" stroke-linejoin="round"/>
        <!-- Front face of paddle antenna -->
        <path d="M 173 52
                 C 173 36, 186 29, 195 34
                 C 200 37, 203 44, 203 54
                 L 199 143
                 C 199 155, 190 163, 181 162
                 C 173 161, 170 153, 170 142 Z"
              fill="var(--surface)" stroke="var(--accent)" stroke-width="1.9" stroke-linejoin="round"/>
        <!-- Inner pill inset -->
        <path d="M 178 55
                 C 178 42, 188 37, 194 41
                 C 197 43, 198 47, 198 54
                 L 195 123
                 C 195 131, 190 136, 184 136
                 C 179 135, 176 130, 176 122 Z"
              fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.5"/>
        <!-- Vertical WiFi 6 marking on right paddle (matching real GL-MT3000) -->
        <g transform="translate(188, 76) rotate(-89)">
          <text x="0" y="3.5" text-anchor="middle" fill="var(--accent)" font-family="var(--font-sans)" font-size="9.5" font-weight="700" letter-spacing="0.4">WiFi</text>
          <rect x="14" y="-5" width="11" height="11" rx="2" fill="var(--accent)"/>
          <text x="19.5" y="3.2" text-anchor="middle" fill="var(--surface)" font-family="var(--font-sans)" font-size="8.5" font-weight="800">6</text>
        </g>
      </g>
    </svg>
  `;
}

function renderGenericRouterSvg({ online, apUp }) {
  const ledFill = online ? 'var(--led-up, #a1ec38)' : apUp ? 'var(--led-warn, #ffbf00)' : 'var(--text-light)';
  return `
    <svg viewBox="0 0 240 165" width="204" height="140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OpenWrt Travel Router">
      <ellipse cx="120" cy="144" rx="82" ry="10" fill="var(--accent-soft)" opacity="0.7"/>
      <rect x="44" y="22" width="14" height="82" rx="7" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/>
      <rect x="182" y="22" width="14" height="82" rx="7" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/>
      <rect x="34" y="84" width="172" height="52" rx="14" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.2"/>
      <line x1="36" y1="112" x2="204" y2="112" stroke="var(--accent)" stroke-width="1.2" opacity="0.7"/>
      <rect x="104" y="109" width="32" height="6" rx="3" fill="${ledFill}" stroke="var(--accent)" stroke-width="1"/>
    </svg>
  `;
}

export function renderDeviceIllustration(board, status) {
  const key = `${board?.boardName || ''} ${board?.model || ''}`.toLowerCase();
  if (key.includes('mt3000') || key.includes('beryl')) {
    return renderGlMt3000Svg(status);
  }
  return renderGenericRouterSvg(status);
}
