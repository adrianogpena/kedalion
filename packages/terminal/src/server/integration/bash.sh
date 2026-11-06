# Kedalion shell integration for bash (and Git Bash), loaded with --rcfile.
# Sources the startup files a login shell would, then wraps the prompt with OSC 133 marks and OSC 7.
if [ -z "${__db_si:-}" ]; then
  __db_si=1
  if [ -r /etc/profile ]; then . /etc/profile; fi
  if [ -r ~/.bash_profile ]; then . ~/.bash_profile
  elif [ -r ~/.bash_login ]; then . ~/.bash_login
  elif [ -r ~/.profile ]; then . ~/.profile
  elif [ -r ~/.bashrc ]; then . ~/.bashrc
  fi

  __db_first=1
  __db_ec=0
  __db_precmd() {
    __db_ec=$?
    # A prompt that already emits its own marks (e.g. Windows Terminal's snippet) sends D itself.
    if [ -z "$__db_first" ] && [ -z "${__db_own_marks:-}" ]; then printf '\033]133;D;%s\007' "$__db_ec"; fi
    __db_first=
    local p="$PWD" w
    if [ -n "${MSYSTEM:-}" ] && w=$(pwd -W 2>/dev/null); then p="/$w"; fi
    printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "${p//%/%25}"
    return $__db_ec
  }
  __db_ps1() {
    case "$PS1" in
      *'133;D'*) __db_own_marks=1 ;;
      *) __db_own_marks= ;;
    esac
    case "$PS1" in
      *'133;B'*) ;;
      *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
    esac
    # Checked every prompt: a PROMPT_COMMAND may reset PS0.
    if [ -n "${__db_ps0:-}" ]; then
      case "${PS0:-}" in
        *'133;C'*) ;;
        *) PS0="${PS0:-}"$'\e]133;C\a' ;;
      esac
      # Start time of the command for the duration segment (expands to nothing).
      case "${PS0:-}" in
        *__db_t0*) ;;
        *) PS0="${PS0:-}"'${__db_nul:$((__db_t0=SECONDS)):0}' ;;
      esac
    fi
    return $__db_ec
  }
  # terminal.prompt = kedalion: the segments of terminal.promptStyle. No forks: Git Bash spawns slowly.
  __db_kp=
  if [ -n "${KEDALION_PROMPT:-}" ]; then
    __db_kp=__db_kprompt
    __db_branch() {
      __db_b=
      local d="$PWD" g h
      while :; do
        g="$d/.git"
        if [ -f "$g" ]; then
          read -r h < "$g"; g="${h#gitdir: }"
          case "$g" in /*|?:*) ;; *) g="$d/$g" ;; esac
        fi
        if [ -r "$g/HEAD" ]; then
          read -r h < "$g/HEAD"
          case "$h" in
            'ref: refs/heads/'*) __db_b="${h#ref: refs/heads/}" ;;
            *) __db_b="${h:0:7}" ;;
          esac
          return
        fi
        [ -z "$d" ] && return
        d="${d%/*}"
      done
    }
    __db_sym="${KEDALION_PROMPT_SYMBOL:-$}"
    __db_nul=x
    case "${OSTYPE:-}" in
      msys*|cygwin*|win*) __db_os=Windows ;;
      darwin*) __db_os=macOS ;;
      linux*) __db_os=Linux ;;
      *) __db_os="${OSTYPE:-}" ;;
    esac
    # Git status: * when there are changes, then the commits ahead (up arrow) and behind (down arrow).
    __db_gstat() {
      __db_gs=
      local l d= a= b= out
      out="$(git status --porcelain=v2 --branch 2>/dev/null)" || return
      while IFS= read -r l; do
        case "$l" in
          '# branch.ab '*) l="${l#\# branch.ab +}"; a="${l%% *}"; b="${l##* -}" ;;
          '#'*) ;;
          ?*) d=1 ;;
        esac
      done <<< "$out"
      [ -n "$d" ] && __db_gs='*'
      [ -n "$a" ] && [ "$a" != 0 ] && __db_gs="$__db_gs ↑$a"
      [ -n "$b" ] && [ "$b" != 0 ] && __db_gs="$__db_gs ↓$b"
      __db_gs="${__db_gs# }"
    }
    # Custom segments: KEDALION_PROMPT_FN_<name> holds the body of prompt_<name>.
    for __db_v in ${!KEDALION_PROMPT_FN_*}; do
      case "${__db_v#KEDALION_PROMPT_FN_}" in *[!a-z0-9_]*) continue ;; esac
      eval "prompt_${__db_v#KEDALION_PROMPT_FN_}() {
:
${!__db_v}
}" 2>/dev/null
      export -n "$__db_v"
    done
    unset __db_v
    # KEDALION_PROMPT: `kind:sgr` tokens (symbol:sgr:errorSgr, custom:sgr:name, newline), see packages/terminal/src/prompt.ts.
    __db_kprompt() {
      local t k s e p v out= sep=
      case " $KEDALION_PROMPT " in *' branch:'*|*' gitstatus:'*) __db_branch ;; esac
      __db_d=
      if [ -n "${__db_t0:-}" ]; then
        v=$((SECONDS - __db_t0))
        if [ "$v" -ge 60 ]; then __db_d="$((v / 60))m$((v % 60))s"; elif [ "$v" -ge 2 ]; then __db_d="${v}s"; fi
        unset __db_t0
      fi
      for t in $KEDALION_PROMPT; do
        k="${t%%:*}"; s="${t#*:}"; e="${s#*:}"; s="${s%%:*}"
        case "$s" in ''|*[!0-9\;]*) s=0 ;; esac
        case "$k" in
          custom) case "$e" in ''|*[!a-z0-9_]*) continue ;; esac ;;
          *) case "$e" in ''|*[!0-9\;]*) e=0 ;; esac ;;
        esac
        # Text from the shell (branch, symbol) goes in as a variable reference so it is never expanded.
        case "$k" in
          newline) out+='\n'; sep=; continue ;;
          cwd) p='\w' ;;
          folder) p='\W' ;;
          user) p='\u' ;;
          host) p='\h' ;;
          time) p='\A' ;;
          branch) [ -z "$__db_b" ] && continue; p='${__db_b}' ;;
          gitstatus) [ -z "$__db_b" ] && continue; __db_gstat; [ -z "$__db_gs" ] && continue; p='${__db_gs}' ;;
          os) [ -z "$__db_os" ] && continue; p='${__db_os}' ;;
          shell) p=bash ;;
          date) p='\D{%Y-%m-%d}' ;;
          duration) [ -z "$__db_d" ] && continue; p='${__db_d}' ;;
          jobs)
            (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || continue
            v='\j'; v="${v@P}"
            [ "$v" = 0 ] && continue
            p='\j' ;;
          venv)
            v="${VIRTUAL_ENV:-${CONDA_DEFAULT_ENV:-}}"; v="${v##*[/\\]}"
            [ -z "$v" ] && continue
            printf -v __db_vv '%s' "$v"; p='${__db_vv}' ;;
          node)
            [ -f package.json ] || continue
            v="$(node --version 2>/dev/null)"; [ -z "$v" ] && continue
            printf -v __db_nv 'node %s' "${v#v}"; p='${__db_nv}' ;;
          java)
            v="${JAVA_HOME:-}"; v="${v%[/\\]}"; v="${v##*[/\\]}"
            [ -z "$v" ] && continue
            printf -v __db_jv '%s' "$v"; p='${__db_jv}' ;;
          status) [ "$__db_ec" = 0 ] && continue; p="$__db_ec" ;;
          symbol) p='${__db_sym}'; [ "$__db_ec" != 0 ] && s="$e" ;;
          custom)
            declare -F "prompt_$e" >/dev/null || continue
            # First line of what the function prints; it runs in a subshell, so it cannot change this shell.
            v="$(PROMPT_STATUS=$__db_ec "prompt_$e" 2>/dev/null)"
            v="${v%%$'\n'*}"
            [ -z "$v" ] && continue
            printf -v "__db_cv_$e" '%s' "$v"
            p='${__db_cv_'"$e"'}' ;;
          *) continue ;;
        esac
        out+="$sep"'\[\e['"$s"'m\]'"$p"'\[\e[0m\]'
        sep=' '
      done
      PS1="$out "
      return $__db_ec
    }
  fi

  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(__db_precmd "${PROMPT_COMMAND[@]}" $__db_kp __db_ps1)
  else
    PROMPT_COMMAND=$'__db_precmd\n'"${PROMPT_COMMAND:-}"$'\n'"$__db_kp"$'\n__db_ps1'
  fi

  if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
    __db_ps0=1
  elif [ -z "$(trap -p DEBUG)" ]; then
    __db_at_prompt=
    __db_preexec() {
      [ -n "${COMP_LINE:-}" ] && return
      [ -z "$__db_at_prompt" ] && return
      __db_at_prompt=
      [ "$BASH_COMMAND" = __db_precmd ] && return
      __db_t0=$SECONDS
      printf '\033]133;C\007'
    }
    trap '__db_preexec' DEBUG
    PROMPT_COMMAND="$PROMPT_COMMAND"$'\n__db_at_prompt=1'
  fi
fi
