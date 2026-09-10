#!/bin/bash
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
# Unset Java 21 java.exe from PATH by removing all non-Android Studio Java entries
exec ./gradlew clean :app:assembleDebug "$@"
