import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import CoursesListScreen from "@/screens/CoursesListScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type CoursesStackParamList = {
  CoursesList: undefined;
};

const Stack = createNativeStackNavigator<CoursesStackParamList>();

export default function CoursesStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="CoursesList"
        component={CoursesListScreen}
        options={{ headerTitle: "Courses" }}
      />
    </Stack.Navigator>
  );
}