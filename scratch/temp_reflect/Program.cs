using System;
using System.Reflection;
using Photino.NET;

namespace ReflectApp
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("=== PhotinoWindow Properties ===");
            foreach (var prop in typeof(PhotinoWindow).GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static))
            {
                Console.WriteLine($"- {prop.PropertyType.Name} {prop.Name}");
            }

            Console.WriteLine("\n=== PhotinoWindow Methods ===");
            foreach (var method in typeof(PhotinoWindow).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static))
            {
                if (method.DeclaringType == typeof(PhotinoWindow))
                {
                    Console.WriteLine($"- {method.ReturnType.Name} {method.Name}");
                }
            }
        }
    }
}
