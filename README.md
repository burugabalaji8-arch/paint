# Sketch to Colour – Photo Animation

Upload a photo (or use the included Radha-Krishna painting) and watch it drawn as a pencil sketch, then painted in with brush strokes until the original colours appear.

Plain HTML, CSS and JavaScript. No Python, no npm, no installs except VS Code and one VS Code extension.
Works on desktop and on phones.

## What is in the folder

```
radha-krishna-animation/
├── index.html      the page
├── style.css       the look (also handles phone layout)
├── script.js       the animation
├── painting.jpg    the sample painting
└── README.md       these instructions
```

## Run it in VS Code (step by step)

1. **Install VS Code** from https://code.visualstudio.com if you don't have it.
2. **Unzip** `radha-krishna-animation.zip`. You get a folder named `radha-krishna-animation`.
3. In VS Code choose **File → Open Folder…** and select that folder.
4. **Install Live Server**:
   - Click the Extensions icon in the left bar (four squares), or press `Ctrl+Shift+X` (`Cmd+Shift+X` on Mac).
   - Search for **Live Server** (author: Ritwick Dey) and click **Install**.
5. In the file list, click **index.html** to open it.
6. Click **Go Live** in the bottom-right corner of VS Code.
   (If you don't see it: right-click `index.html` → **Open with Live Server**.)
7. Your browser opens at `http://127.0.0.1:5500` showing the page.
8. Press **Start**, or press **Upload image** and choose any photo. After an upload the animation starts by itself.

To stop the server, click the **Port: 5500** label in the bottom-right corner of VS Code.

> Why Live Server and not a double-click on `index.html`? Browsers block local files from reading image pixels, so the sample painting would not load. Live Server avoids that. Even when double-clicked, **Upload image** still works for photos you pick yourself.

## Controls

| Control | What it does |
|---|---|
| **Upload image** | Pick a photo from your computer or phone gallery. You can also drag a photo onto the picture |
| **Start** | Begins the animation |
| **Pause / Resume** | Freezes and continues exactly where it stopped |
| **Restart** | Plays again from the beginning (new random brush strokes each time) |
| **Speed** | 0.25× (slow) to 4× (fast), adjustable while playing |
| **Sample painting** | Goes back to the included painting |

Photos stay on your device. Nothing is uploaded to a server.

## Try it on your phone while testing

1. Connect the phone and the computer to the **same Wi-Fi**.
2. Find your computer's local IP address (Windows: run `ipconfig` and read "IPv4 Address"; Mac: System Settings → Wi-Fi → Details).
3. On the phone, open `http://YOUR-IP:5500` (for example `http://192.168.1.20:5500`) while Live Server is running.
4. Allow Live Server through the firewall if your computer asks.

## Share it with someone

Live Server only works on your own network. To give your partner a real link, upload the folder to a free static host:

- **Netlify:** sign in at https://app.netlify.com, open **Sites**, and drag the whole `radha-krishna-animation` folder onto the "Deploy manually" area. You get a web address to send to her.
- **GitHub Pages:** create a repository, upload the four files and the painting, then turn on Pages in the repository settings.

## Customise (top of `script.js`)

- `DURATION` – seconds for the sketch, a short pause, and the colour phase (at 1× speed).
- `PAPER`, `GRAPHITE` – colour of the paper and the pencil.
- `MAX_SIDE` – lower it (for example `1000`) if the animation feels choppy. Phones already use a lower value automatically.
- `IMAGE_FILE` – the sample picture's file name (default `painting.jpg`).

## Troubleshooting

- **"Could not load painting.jpg"**: the file must be in the same folder as `index.html` and named exactly `painting.jpg`.
- **A message says the browser blocked the image**: open the page with Live Server, or use **Upload image**.
- **An iPhone photo won't open**: HEIC photos are not supported by every browser. Take or save the photo as JPG, or send it through a chat app, which usually converts it.
- **Changes to the code don't show**: hard-refresh with `Ctrl+F5` (`Cmd+Shift+R` on Mac).
- **Slow or choppy on an older phone**: lower `MAX_SIDE` in `script.js` and use a smaller photo.

## How it works (short version)

1. The picture is drawn to a hidden canvas and its pixels are read.
2. A pencil sketch is generated (grayscale, blurred negative "colour dodge", hatching, paper grain).
3. Hundreds of bristle-style strokes are drawn into invisible masks. The masks decide where the sketch, a soft underpainting and finally the real colours show.
4. The canvas takes the picture's own width and height, so proportions never change. CSS only scales it to fit the screen.
