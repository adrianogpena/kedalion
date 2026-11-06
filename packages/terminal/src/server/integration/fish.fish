# Kedalion shell integration for fish, run with --init-command after the user's config.
if not set -q __db_si
    set -g __db_si 1
    function __db_prompt --on-event fish_prompt
        printf '\e]7;file://%s%s\a' $hostname (string replace -a % %25 -- $PWD)
    end
    # The command line goes first (OSC 633 E, VS Code's escaping) for the command history.
    function __db_preexec --on-event fish_preexec
        set -l c (string replace -a -- '\\' '\\\\' $argv | string replace -a -- ';' '\\x3b' | string replace -a -- \e '' | string replace -a -- \a '')
        printf '\e]633;E;%s\a\e]133;C\a' (string join '\x0a' -- $c)
    end
    function __db_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end
    # terminal.prompt = kedalion: folder, git branch, arrow (red after a failure).
    if set -q KEDALION_PROMPT
        switch (uname 2>/dev/null)
            case Darwin
                set -g __db_os macOS
            case Linux
                set -g __db_os Linux
            case 'MSYS*' 'CYGWIN*' 'MINGW*'
                set -g __db_os Windows
            case '*'
                set -g __db_os ''
        end
        function fish_prompt
            set -l s $status
            set -l d $PWD
            set -l b
            string match -qr ' (branch|gitstatus):' -- " $KEDALION_PROMPT "; or set d ''
            while test -n "$d"
                set -l g $d/.git
                if test -f $g
                    read -l h <$g
                    set g (string replace -r '^gitdir: ' '' -- $h)
                    string match -qr '^(/|[A-Za-z]:)' -- $g; or set g $d/$g
                end
                if test -r $g/HEAD
                    read -l h <$g/HEAD
                    if string match -q 'ref: refs/heads/*' -- $h
                        set b (string replace 'ref: refs/heads/' '' -- $h)
                    else
                        set b (string sub -l 7 -- $h)
                    end
                    break
                end
                test -z "$d"; and break
                set d (string replace -r '/[^/]*$' '' -- $d)
            end
            set -l sym '$'
            set -q KEDALION_PROMPT_SYMBOL; and set sym $KEDALION_PROMPT_SYMBOL
            set -l sep ''
            # KEDALION_PROMPT: `kind:sgr` tokens (symbol:sgr:errorSgr, newline), see packages/terminal/src/prompt.ts.
            for t in (string split ' ' -- $KEDALION_PROMPT)
                set -l parts (string split ':' -- $t)
                set -l k $parts[1]
                set -l sgr $parts[2]
                string match -qr '^[0-9;]+$' -- "$sgr"; or set sgr 0
                set -l p
                switch $k
                    case newline
                        printf '\n'
                        set sep ''
                        continue
                    case cwd
                        set p (string replace -r "^$HOME" '~' -- $PWD)
                    case folder
                        set p (path basename -- $PWD)
                    case user
                        set p $USER
                    case host
                        set p (prompt_hostname)
                    case time
                        set p (date +%H:%M)
                    case branch
                        set p $b
                    case gitstatus
                        test -n "$b"; or continue
                        set -l parts
                        set -l ahead 0
                        set -l behind 0
                        for l in (git status --porcelain=v2 --branch 2>/dev/null)
                            if string match -q '# branch.ab *' -- $l
                                set -l m (string match -r '\+(\d+) -(\d+)' -- $l)
                                set ahead $m[2]
                                set behind $m[3]
                            else if not string match -q '#*' -- $l
                                contains -- '*' $parts; or set parts '*'
                            end
                        end
                        test $ahead -gt 0; and set -a parts "↑$ahead"
                        test $behind -gt 0; and set -a parts "↓$behind"
                        set p (string join ' ' -- $parts)
                    case os
                        set p $__db_os
                    case shell
                        set p fish
                    case date
                        set p (date +%Y-%m-%d)
                    case duration
                        set -q CMD_DURATION; or continue
                        test $CMD_DURATION -ge 2000; or continue
                        set -l n (math -s0 $CMD_DURATION / 1000)
                        if test $n -ge 60
                            set p (math -s0 "floor($n / 60)")m(math -s0 $n % 60)s
                        else
                            set p {$n}s
                        end
                    case jobs
                        set -l n (count (jobs -p 2>/dev/null))
                        test $n -gt 0; and set p $n
                    case venv
                        set -l v $VIRTUAL_ENV
                        test -z "$v"; and set v $CONDA_DEFAULT_ENV
                        test -n "$v"; or continue
                        set p (path basename -- $v)
                    case node
                        test -f package.json; or continue
                        set -l v (node --version 2>/dev/null)
                        test -n "$v"; or continue
                        set p "node "(string replace -r '^v' '' -- $v)
                    case java
                        test -n "$JAVA_HOME"; or continue
                        set p (path basename -- (string replace -r '/$' '' -- $JAVA_HOME))
                    case status
                        test $s -ne 0; and set p $s
                    case symbol
                        set p $sym
                        if test $s -ne 0; and string match -qr '^[0-9;]+$' -- "$parts[3]"
                            set sgr $parts[3]
                        end
                    case '*'
                        continue
                end
                test -z "$p"; and continue
                printf '%s\e[%sm%s\e[0m' $sep $sgr $p
                set sep ' '
            end
            printf ' '
        end
    end
    function __db_restore_status
        return $argv[1]
    end
    if functions -q fish_prompt
        functions -c fish_prompt __db_user_prompt
        function fish_prompt
            set -l s $status
            printf '\e]133;A\a'
            __db_restore_status $s
            __db_user_prompt
            printf '\e]133;B\a'
        end
    end
end
