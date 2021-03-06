#!/bin/bash

source $(dirname $0)/is-bump-commit.sh

if isBumpCommit
then
  echo "Skipping install step for version bump commit"
  exit 0
fi

npm install

# If bower configuration and bower command are present install bower dependencies
if [ -f bower.json ]
then
  if ! [ which bower > /dev/null ]
  then
    npm install -g bower
  fi
  bower install
fi
