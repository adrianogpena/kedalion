# Kedalion shell integration for zsh: the .zshrc in the integration ZDOTDIR.
# Sources the user's .zshrc, then adds precmd/preexec hooks for OSC 133 marks and OSC 7.
__db_ours=$ZDOTDIR
ZDOTDIR=${KEDALION_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
KEDALION_USER_ZDOTDIR=$ZDOTDIR
# A login shell still reads .zlogin from here; that one restores the user's ZDOTDIR.
[[ -o login ]] && ZDOTDIR=$__db_ours
unset __db_ours

__db_first=1
__db_ec=0
__db_status() { __db_ec=$? }
__db_precmd() {
  [[ -z $__db_first ]] && printf '\e]133;D;%s\a' $__db_ec
  __db_first=
  printf '\e]7;file://%s%s\a' ${HOST:-localhost} ${PWD//\%/%25}
  [[ $PS1 == *'133;B'* ]] || PS1=$'%{\e]133;A\a%}'$PS1$'%{\e]133;B\a%}'
}
# The command line goes first (OSC 633 E, VS Code's escaping) for the command history.
__db_preexec() {
  local c=${1//\\/\\\\}
  c=${c//;/\\x3b}
  c=${c//$'\n'/\\x0a}
  c=${c//$'\a'/}
  c=${c//$'\e'/}
  printf '\e]633;E;%s\a\e]133;C\a' "$c"
}
precmd_functions=(__db_status $precmd_functions __db_precmd)
preexec_functions=($preexec_functions __db_preexec)
