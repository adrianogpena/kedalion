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
  __db_t0=$SECONDS
  local c=${1//\\/\\\\}
  c=${c//;/\\x3b}
  c=${c//$'\n'/\\x0a}
  c=${c//$'\a'/}
  c=${c//$'\e'/}
  printf '\e]633;E;%s\a\e]133;C\a' "$c"
}
# terminal.prompt = kedalion: the segments of terminal.promptStyle.
__db_kp=()
if [[ -n $KEDALION_PROMPT ]]; then
  __db_kp=(__db_kprompt)
  # Custom segments: KEDALION_PROMPT_FN_<name> holds the body of prompt_<name>.
  for __db_v in ${(k)parameters[(I)KEDALION_PROMPT_FN_*]}; do
    [[ ${__db_v#KEDALION_PROMPT_FN_} == *[^a-z0-9_]* ]] && continue
    eval "prompt_${__db_v#KEDALION_PROMPT_FN_}() {
:
${(P)__db_v}
}" 2>/dev/null
    typeset +x $__db_v
  done
  unset __db_v
  case $OSTYPE in
    darwin*) __db_os=macOS ;;
    linux*) __db_os=Linux ;;
    msys*|cygwin*|win*) __db_os=Windows ;;
    *) __db_os=$OSTYPE ;;
  esac
  # A segment's text as the prompt shows it: a variable reference with prompt_subst, else the text with % escaped.
  __db_sv() {
    typeset -g __db_cv_$1=${2//\%/%%}
    if [[ -o prompt_subst ]]; then __db_p="\${__db_cv_$1}"; else __db_p=${2//\%/%%}; fi
  }
  # Git status: * when there are changes, then the commits ahead (up arrow) and behind (down arrow).
  __db_gstat() {
    __db_gs=
    local out l a= b= dirty=
    out=$(git status --porcelain=v2 --branch 2>/dev/null) || return
    for l in ${(f)out}; do
      case $l in
        '# branch.ab '*) l=${l#'# branch.ab +'}; a=${l%% *}; b=${l##* -} ;;
        '#'*) ;;
        *) dirty=1 ;;
      esac
    done
    [[ -n $dirty ]] && __db_gs='*'
    [[ -n $a && $a != 0 ]] && __db_gs="$__db_gs ↑$a"
    [[ -n $b && $b != 0 ]] && __db_gs="$__db_gs ↓$b"
    __db_gs=${__db_gs# }
  }
  __db_kprompt() {
    local d=$PWD g h b=
    [[ " $KEDALION_PROMPT " == *' branch:'* || " $KEDALION_PROMPT " == *' gitstatus:'* ]] || d=
    __db_d=
    if [[ -n $__db_t0 ]]; then
      local n=$(( SECONDS - __db_t0 ))
      if (( n >= 60 )); then __db_d="$(( n / 60 ))m$(( n % 60 ))s"; elif (( n >= 2 )); then __db_d="${n}s"; fi
      unset __db_t0
    fi
    while [[ -n $d ]]; do
      g=$d/.git
      if [[ -f $g ]]; then
        read -r h < $g; g=${h#gitdir: }
        [[ $g == /* ]] || g=$d/$g
      fi
      if [[ -r $g/HEAD ]]; then
        read -r h < $g/HEAD
        if [[ $h == 'ref: refs/heads/'* ]]; then b=${h#ref: refs/heads/}; else b=${h[1,7]}; fi
        break
      fi
      d=${d%/*}
    done
    # %% keeps a % literal; with prompt_subst the branch and symbol go in as variable references so they are never expanded.
    __db_b=${b//\%/%%}
    __db_sym=${${KEDALION_PROMPT_SYMBOL:-'$'}//\%/%%}
    local t k s e p v out= sep=
    # KEDALION_PROMPT: `kind:sgr` tokens (symbol:sgr:errorSgr, custom:sgr:name, newline), see packages/terminal/src/prompt.ts.
    for t in ${=KEDALION_PROMPT}; do
      k=${t%%:*}; s=${t#*:}; e=${s#*:}; s=${s%%:*}
      [[ -z $s || $s == *[^0-9\;]* ]] && s=0
      if [[ $k == custom ]]; then
        [[ -z $e || $e == *[^a-z0-9_]* ]] && continue
      else
        [[ -z $e || $e == *[^0-9\;]* ]] && e=0
      fi
      case $k in
        custom) (( $+functions[prompt_$e] )) || continue
          # First line of what the function prints; it runs in a subshell, so it cannot change this shell.
          v=$(PROMPT_STATUS=$__db_ec prompt_$e 2>/dev/null)
          v=${${v%%$'\n'*}//\%/%%}
          [[ -z $v ]] && continue
          typeset -g __db_cv_$e=$v
          if [[ -o prompt_subst ]]; then p="\${__db_cv_$e}"; else p=$v; fi ;;
        newline) out+=$'\n'; sep=; continue ;;
        cwd) p='%~' ;;
        folder) p='%1~' ;;
        user) p='%n' ;;
        host) p='%m' ;;
        time) p='%T' ;;
        branch) [[ -z $b ]] && continue
          if [[ -o prompt_subst ]]; then p='${__db_b}'; else p=$__db_b; fi ;;
        gitstatus) [[ -z $b ]] && continue
          __db_gstat; [[ -z $__db_gs ]] && continue
          __db_sv gitstatus $__db_gs; p=$__db_p ;;
        os) [[ -z $__db_os ]] && continue; __db_sv os $__db_os; p=$__db_p ;;
        shell) p=zsh ;;
        date) p='%D{%Y-%m-%d}' ;;
        duration) [[ -z $__db_d ]] && continue; __db_sv duration $__db_d; p=$__db_p ;;
        jobs) (( ${#jobstates} )) || continue; p=${#jobstates} ;;
        venv) v=${VIRTUAL_ENV:-$CONDA_DEFAULT_ENV}; v=${v:t}
          [[ -z $v ]] && continue; __db_sv venv $v; p=$__db_p ;;
        node) [[ -f package.json ]] || continue
          v=$(node --version 2>/dev/null); [[ -z $v ]] && continue
          __db_sv node "node ${v#v}"; p=$__db_p ;;
        java) v=${${JAVA_HOME%/}:t}; [[ -z $v ]] && continue; __db_sv java $v; p=$__db_p ;;
        status) (( __db_ec )) || continue; p=$__db_ec ;;
        symbol) (( __db_ec )) && s=$e
          if [[ -o prompt_subst ]]; then p='${__db_sym}'; else p=$__db_sym; fi ;;
        *) continue ;;
      esac
      out+="$sep%{"$'\e'"[${s}m%}$p%{"$'\e'"[0m%}"
      sep=' '
    done
    PS1="$out "
  }
fi
precmd_functions=(__db_status $precmd_functions $__db_kp __db_precmd)
preexec_functions=($preexec_functions __db_preexec)
