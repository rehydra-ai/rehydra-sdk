Output demo.gif

Set Shell zsh
Set WindowBar Colorful
Set FontSize 20
Set Width 900
Set Height 350
Set Padding 20
Set TypingSpeed 60ms
Set FontFamily "FiraCode Nerd Font"
Set LineHeight 1.4

# Set up the message
Type `msg="Call John at +41 79 123 45 67"`
Sleep 500ms
Enter
Sleep 500ms

# Anonymize with NER
Type "echo $msg | rehydra anonymize --ner quantized --quiet"
Sleep 500ms
Enter
Sleep 4s

# Rehydrate
Type `echo 'Call <PII type="PERSON" id="1"/> at <PII type="PHONE" id="2"/>' | rehydra rehydrate`
Sleep 500ms
Enter
Sleep 4s
