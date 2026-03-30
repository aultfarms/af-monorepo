#! /bin/bash

CYAN="\033[1;36m"
NOCOLOR="\033[0m"

sleepbuild () {
  sleep 1 && yarn build
}

trybuild () {
  sleepbuild || sleepbuild || sleepbuild || sleepbuild
}

APP="fuel"
MONOREPODIR="/Users/aultac/repos/aultfarms/af-monorepo/apps/${APP}"
OLDVERSION=`jq -r '.version' package.json`
NEWVERSION=`echo $OLDVERSION | awk -F '.' '{printf("%d.%d.%d", $1, $2, $3+1)}'`

cd $MONOREPODIR
echo -e "$CYAN--------> Bumping version from $OLDVERSION to $NEWVERSION and commiting to git before push$NOCOLOR"
jq ".version = \"$NEWVERSION\"" package.json > package-versionbump.json
mv package-versionbump.json package.json
git add package.json
git commit -m "v$NEWVERSION deploy"
echo -e "$CYAN--------> Push latest from master (did you remember to commit?)$NOCOLOR"
git push

cd ~/repos/aultfarms/${APP}
git checkout -- yarn.lock
git pull monorepo master
git push origin master
# There are weird issues with yarn and paths being undefined if you don't do it like this:
echo -e "$CYAN--------> root workspace yarn $NOCOLOR"
yarn && \
cd apps/${APP} && \
echo -e "$CYAN--------> ${APP} yarn $NOCOLOR" && \
yarn && \
echo -e "$CYAN--------> yarn build:libs $NOCOLOR" && \
yarn build:libs && \
echo -e "$CYAN--------> yarn build (try up to 4 times) $NOCOLOR" && \
# Yep, build is non-deterministic.  Bleh
trybuild && \
echo -e "$CYAN--------> yarn deploy$NOCOLOR" && \
yarn deploy && \
echo -e "$CYAN--------> Successfully Deployed v$NEWVERSION"