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
    if functions -q fish_prompt
        functions -c fish_prompt __db_user_prompt
        function fish_prompt
            printf '\e]133;A\a'
            __db_user_prompt
            printf '\e]133;B\a'
        end
    end
end
