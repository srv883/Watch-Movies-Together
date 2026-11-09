# Generates the two TTS "microphones" used by the voice rig (48 kHz mono 16-bit).
# Run:  powershell -File tests\rig\tts.ps1   then   node tests\rig\make-variants.js
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$v = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$s.SelectVoice(($v | Where-Object { $_.Gender -eq "Male" } | Select-Object -First 1).Name)
$s.SetOutputToWaveFile("$here\host_raw.wav", $fmt)
$s.Speak("Hey Priya, can you hear me now? This scene is about to get really intense. Did you see what he just did there? I think the detective already knows who the killer is. Let us pause it for a second and grab some snacks. Okay, playing again in three, two, one.")
$s.SetOutputToNull()
$s.SelectVoice(($v | Where-Object { $_.Gender -eq "Female" } | Select-Object -First 1).Name)
$s.SetOutputToWaveFile("$here\guest_raw.wav", $fmt)
$s.Speak("Yes Sourav, I can hear you. Wait, who is that woman in the red coat? I missed the last line, can you rewind ten seconds? Honestly this episode is way better than the last one. The music in this part is so good. Tell me when you are ready and I will press play.")
$s.SetOutputToNull(); $s.Dispose()
