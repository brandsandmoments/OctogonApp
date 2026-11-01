#!/bin/bash
# Utilizatorul și parola selfAWB (Fan Courier), în .env, apoi repornire și prima citire.
# Un singur utilizator pentru toate brandurile; ID-urile de client sunt deja în aplicație.
# Rulează pe server, ca root: bash /opt/octogon/deploy/pune-fan.sh
set -e
read -r -p "Utilizator selfAWB: " U
read -r -s -p "Parola selfAWB (nu se vede când scrii): " P; echo
if [ -z "$U" ] || [ -z "$P" ]; then echo "Utilizatorul și parola nu pot fi goale. Nimic schimbat."; exit 1; fi
# Verificare la Fan, înainte de a salva.
COD=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST https://api.fancourier.ro/login --data-urlencode "username=$U" --data-urlencode "password=$P")
if [ "$COD" != "200" ]; then echo "Fan nu acceptă utilizatorul și parola (răspuns $COD). Verifică-le în selfAWB. Nimic schimbat."; exit 1; fi
cd /opt/octogon
sed -i "/^FAN_USER=/d; /^FAN_PAROLA=/d" .env
printf "FAN_USER=%s\nFAN_PAROLA=%s\n" "$U" "$P" >> .env
systemctl restart octogon; sleep 5
systemctl is-active --quiet octogon && echo "Gata: Fan Courier e legat. Prima citire (60 de zile) pornește acum și durează câteva minute."
systemctl start --no-block octogon-financiar.service
