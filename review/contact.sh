#!/bin/bash
# Usage: review/contact.sh <round>  -> review/out/<round>/sheets/{shots-N.png, station-<id>.png}
set -e; D="$(dirname "$0")/out/$1"; S="$D/sheets"; mkdir -p "$S"
# stations: mid f0 f1 / f2 f3 exit, each 960x540 -> 2880x1080
for d in "$D"/stations/*/; do id=$(basename "$d")
  ffmpeg -loglevel error -y -i "$d/mid.png" -i "$d/f0.png" -i "$d/f1.png" -i "$d/f2.png" -i "$d/f3.png" -i "$d/exit.png" \
   -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[4]scale=960:540[e];[5]scale=960:540[f];[a][b][c][d][e][f]xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0" "$S/station-$id.png"; done
# shots: 2x2 at 960x540
ls "$D"/shots/*.png | grep -v '/_' > "$S/.list"; n=0; i=0; args=(); while read f; do args+=(-i "$f"); i=$((i+1)); if [ $i -eq 4 ]; then
  ffmpeg -loglevel error -y "${args[@]}" -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0" "$S/shots-$n.png"; n=$((n+1)); i=0; args=(); fi; done < "$S/.list"
for f in "${args[@]}"; do [ "$f" != -i ] && cp "$f" "$S/shots-rest-$(basename "$f")"; done; ls "$S"
